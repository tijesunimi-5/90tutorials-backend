import { Router } from "express";
import pool from "../../utils/helpers/db.mjs";
import { validateSession } from "../../utils/middlewares/validateSession.mjs";

const router = Router();

/**
 * Utility to fetch the answer key along with subject names for scoring.
 */
async function getExamAnswerKey(examId, client) {
  const query = `
    SELECT q.question_id, o.option_id AS correct_option_id, s.name AS subject_name
    FROM questions q
    JOIN subjects s ON q.subject_id = s.subject_id
    JOIN options o ON q.question_id = o.question_id
    WHERE s.exam_id = $1 AND o.is_correct = TRUE;
  `;
  const { rows } = await client.query(query, [examId]);
  const answerKey = {};
  const subjectKey = {};
  rows.forEach((row) => {
    answerKey[row.question_id] = row.correct_option_id;
    subjectKey[row.question_id] = row.subject_name;
  });
  return { answerKey, subjectKey };
}

/**
 * 1. POST Submission Route
 * Normalizes results: Each subject is scored out of 100.
 */
router.post("/results/submit", validateSession, async (request, response) => {
  const {
    examId,
    answers,
    endTime,
    startTime,
    totalTimeSeconds,
    violationCount,
    isTimeUp,
  } = request.body;
  const studentEmail = request.user?.email;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const studentAuthResult = await client.query(
      `SELECT id, exam_auth_id, authorized_at, sequential_num FROM students_authorized WHERE LOWER(email) = LOWER($1)`,
      [studentEmail],
    );
    if (studentAuthResult.rows.length === 0) throw new Error("Unauthorized.");
    const studentAuthRow = studentAuthResult.rows[0];

    const { answerKey, subjectKey } = await getExamAnswerKey(examId, client);
    const subjectMap = {};

    const answeredDetails = answers.map((ans) => {
      const isCorrect =
        Number(ans.chosenOptionId) === Number(answerKey[ans.questionId]);
      const subName = subjectKey[ans.questionId] || "General";

      if (!subjectMap[subName]) subjectMap[subName] = { correct: 0, total: 0 };
      subjectMap[subName].total++;
      if (isCorrect) subjectMap[subName].correct++;

      return {
        questionId: ans.questionId,
        chosenOptionId: ans.chosenOptionId,
        isCorrect,
        scoreAwarded: isCorrect ? 1.0 : 0.0,
      };
    });

    // 🟢 AGGREGATE CALCULATION: Normalized per subject
    let aggregateScore = 0;
    const subjectEntries = Object.entries(subjectMap);

    // Initial insert to get attempt_id
    const attemptResult = await client.query(
      `INSERT INTO exam_attempts (
        student_auth_id, exam_id, total_score, total_questions, correct_answers, 
        start_time, end_time, time_taken_seconds, violation_count, submission_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING attempt_id`,
      [
        studentAuthRow.id,
        examId,
        0, // placeholder
        answers.length,
        0, // placeholder
        startTime,
        endTime,
        totalTimeSeconds || 0,
        violationCount || 0,
        isTimeUp ? "TIMED_OUT" : "COMPLETED",
      ],
    );
    const attemptId = attemptResult.rows[0].attempt_id;

    // Save individual subject scores scaled to 100
    for (const [subjectName, stats] of subjectEntries) {
      const subScore =
        stats.total > 0
          ? parseFloat(((stats.correct / stats.total) * 100).toFixed(2))
          : 0;
      aggregateScore += subScore;

      await client.query(
        `INSERT INTO attempt_subject_scores (attempt_id, subject_name, score, correct_count, total_questions) VALUES ($1, $2, $3, $4, $5)`,
        [attemptId, subjectName, subScore, stats.correct, stats.total],
      );
    }

    // Final update with the summed aggregate and correct count
    const finalCorrectAnswers = answeredDetails.filter(
      (d) => d.isCorrect,
    ).length;
    await client.query(
      `UPDATE exam_attempts SET total_score = $1, correct_answers = $2 WHERE attempt_id = $3`,
      [parseFloat(aggregateScore.toFixed(2)), finalCorrectAnswers, attemptId],
    );

    // Save question-by-question log
    if (answeredDetails.length > 0) {
      const answerValues = answeredDetails
        .map(
          (_, i) =>
            `($${i * 5 + 1}, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}, $${i * 5 + 5})`,
        )
        .join(", ");
      const answerParams = answeredDetails.flatMap((d) => [
        attemptId,
        d.questionId,
        d.chosenOptionId || null,
        d.isCorrect,
        d.scoreAwarded,
      ]);
      await client.query(
        `INSERT INTO attempt_answers (attempt_id, question_id, chosen_option_id, is_correct, score_awarded) VALUES ${answerValues}`,
        answerParams,
      );
    }

    await client.query("COMMIT");
    return response
      .status(201)
      .send({ message: "Success", data: { attemptId, aggregateScore } });
  } catch (error) {
    await client.query("ROLLBACK");
    return response
      .status(500)
      .send({ message: "Submission failed.", error: error.message });
  } finally {
    client.release();
  }
});

/**
 * 2. GET Student Attempts Route
 */
router.get("/student/attempts", validateSession, async (request, response) => {
  const userEmail = request.user?.email;
  const client = await pool.connect();
  try {
    const authRes = await client.query(
      `SELECT id FROM students_authorized WHERE LOWER(email) = LOWER($1)`,
      [userEmail],
    );
    if (authRes.rows.length === 0)
      return response.status(200).send({ data: [] });
    const studentAuthId = authRes.rows[0].id;

    const summaryRows = (
      await client.query(
        `SELECT ea.*, e.title AS exam_title, e.results_release_at 
       FROM exam_attempts ea 
       JOIN examinations e ON ea.exam_id = e.exam_id 
       WHERE ea.student_auth_id = $1 ORDER BY ea.end_time DESC`,
        [studentAuthId],
      )
    ).rows;

    if (summaryRows.length === 0)
      return response.status(200).send({ data: [] });
    const attemptIds = summaryRows.map((r) => r.attempt_id);

    const detailRows = (
      await client.query(
        `SELECT aa.*, q.question_text, s.name AS subject_name, o_chosen.option_text AS chosen_answer_text, o_correct.option_text AS correct_answer_text
       FROM attempt_answers aa JOIN questions q ON aa.question_id = q.question_id JOIN subjects s ON q.subject_id = s.subject_id
       LEFT JOIN options o_chosen ON aa.chosen_option_id = o_chosen.option_id
       LEFT JOIN options o_correct ON q.question_id = o_correct.question_id AND o_correct.is_correct = TRUE
       WHERE aa.attempt_id = ANY($1::int[])`,
        [attemptIds],
      )
    ).rows;

    const subjectScores = (
      await client.query(
        `SELECT * FROM attempt_subject_scores WHERE attempt_id = ANY($1::int[])`,
        [attemptIds],
      )
    ).rows;

    const finalData = summaryRows.map((s) => ({
      ...s,
      total_score: parseFloat(s.total_score),
      details: detailRows.filter((d) => d.attempt_id === s.attempt_id),
      subject_breakdown: subjectScores.filter(
        (sb) => sb.attempt_id === s.attempt_id,
      ),
      is_released:
        !s.results_release_at || new Date(s.results_release_at) <= new Date(),
    }));
    return response.status(200).send({ data: finalData });
  } catch (error) {
    return response.status(500).send({ message: "Error" });
  } finally {
    client.release();
  }
});

/**
 * 3. GET Admin Summary Route
 */
router.get(
  "/results/summary/:examId",
  validateSession,
  async (request, response) => {
    const examId = parseInt(request.params.examId);
    const client = await pool.connect();
    try {
      const summaryRows = (
        await client.query(
          `SELECT ea.*, u.name AS student_name, 
                ea_rec.unique_id || '/' || to_char(sa.authorized_at, 'YY') || '/' || LPAD(sa.sequential_num::text, 4, '0') AS student_id_code
         FROM exam_attempts ea 
         JOIN students_authorized sa ON ea.student_auth_id = sa.id
         JOIN exams_authorized ea_rec ON sa.exam_auth_id = ea_rec.id 
         LEFT JOIN users u ON sa.email = u.email
         WHERE ea.exam_id = $1 ORDER BY ea.total_score DESC`,
          [examId],
        )
      ).rows;

      if (summaryRows.length === 0)
        return response.status(200).send({ data: [] });
      const attemptIds = summaryRows.map((r) => r.attempt_id);

      const detailRows = (
        await client.query(
          `SELECT aa.*, q.question_text, s.name AS subject_name, o_chosen.option_text AS chosen_answer_text, o_correct.option_text AS correct_answer_text
         FROM attempt_answers aa JOIN questions q ON aa.question_id = q.question_id JOIN subjects s ON q.subject_id = s.subject_id
         LEFT JOIN options o_chosen ON aa.chosen_option_id = o_chosen.option_id
         LEFT JOIN options o_correct ON q.question_id = o_correct.question_id AND o_correct.is_correct = TRUE
         WHERE aa.attempt_id = ANY($1::int[])`,
          [attemptIds],
        )
      ).rows;

      const subjectScores = (
        await client.query(
          `SELECT * FROM attempt_subject_scores WHERE attempt_id = ANY($1::int[])`,
          [attemptIds],
        )
      ).rows;

      return response.status(200).send({
        data: summaryRows.map((s) => ({
          ...s,
          total_score: parseFloat(s.total_score),
          details: detailRows.filter((d) => d.attempt_id === s.attempt_id),
          subject_breakdown: subjectScores.filter(
            (sb) => sb.attempt_id === s.attempt_id,
          ),
        })),
      });
    } catch (error) {
      return response.status(500).send({ message: "Error" });
    } finally {
      client.release();
    }
  },
);

/**
 * 4. Check Exam Status
 */
router.get("/check/:examId", validateSession, async (request, response) => {
  const { examId } = request.params;
  const userEmail = request.user?.email;
  try {
    const authRes = await pool.query(
      `SELECT id FROM students_authorized WHERE LOWER(email) = LOWER($1)`,
      [userEmail],
    );
    if (authRes.rows.length === 0)
      return response.status(200).send({ hasTaken: false, canTakeAgain: true });
    const studentAuthId = authRes.rows[0].id;
    const examInfo = (
      await pool.query(
        `SELECT allow_multiple_attempts FROM examinations WHERE exam_id = $1`,
        [examId],
      )
    ).rows[0];
    const attempts = (
      await pool.query(
        `SELECT attempt_id FROM exam_attempts WHERE student_auth_id = $1 AND exam_id = $2`,
        [studentAuthId, examId],
      )
    ).rows;
    return response
      .status(200)
      .send({
        hasTaken: attempts.length > 0,
        canTakeAgain:
          examInfo?.allow_multiple_attempts || attempts.length === 0,
        attemptId: attempts[0]?.attempt_id,
      });
  } catch (error) {
    return response.status(500).send({ message: "Failed." });
  }
});

/**
 * 5. GET All Exams
 */
router.get("/results/exams", validateSession, async (request, response) => {
  try {
    const { rows } = await pool.query(
      `SELECT exam_id, title FROM examinations ORDER BY title`,
    );
    return response.status(200).send({ data: rows });
  } catch (error) {
    return response.status(500).send({ message: "Failed." });
  }
});

export default router;
