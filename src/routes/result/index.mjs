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
    JOIN examinations e ON s.exam_id = e.exam_id
    JOIN options o ON q.question_id = o.question_id
    WHERE e.exam_id = $1 AND o.is_correct = TRUE;
  `;
  const { rows } = await client.query(query, [examId]);

  const answerKey = {};
  const subjectKey = {}; // Map question IDs to subject names

  rows.forEach((row) => {
    answerKey[row.question_id] = row.correct_option_id;
    subjectKey[row.question_id] = row.subject_name;
  });

  return { answerKey, subjectKey, keyRows: rows };
}

/**
 * 1. POST Submission Route
 * Calculates global score AND per-subject breakdown scores.
 * Saves tracking metrics (violations, time taken).
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

  if (!studentEmail || !examId || !Array.isArray(answers) || !endTime) {
    return response.status(400).send({ message: "Missing required fields." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // A. Identify student authorization
    const studentAuthResult = await client.query(
      `SELECT id, exam_auth_id, authorized_at, sequential_num 
       FROM students_authorized 
       WHERE LOWER(email) = LOWER($1)`,
      [studentEmail],
    );

    if (studentAuthResult.rows.length === 0) {
      throw new Error("Student is not authorized for this exam.");
    }
    const studentAuthRow = studentAuthResult.rows[0];

    // B. Scoring Logic (Global and Subject-Specific)
    const { answerKey, subjectKey } = await getExamAnswerKey(examId, client);

    const subjectMap = {}; // Tracker for subject stats: { "Biology": { correct: 0, total: 0 } }
    let globalCorrectCount = 0;

    const answeredDetails = answers.map((ans) => {
      const isCorrect =
        Number(ans.chosenOptionId) === Number(answerKey[ans.questionId]);
      const subName = subjectKey[ans.questionId] || "General";

      if (isCorrect) globalCorrectCount++;

      // Update subject-specific counters
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

    const finalScore =
      answers.length > 0
        ? parseFloat(((globalCorrectCount / answers.length) * 100).toFixed(2))
        : 0;

    // C. Save the Main Attempt
    const attemptQuery = `
      INSERT INTO exam_attempts (
        student_auth_id, exam_id, total_score, total_questions, correct_answers, 
        start_time, end_time, time_taken_seconds, violation_count, submission_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING attempt_id`;

    const attemptResult = await client.query(attemptQuery, [
      studentAuthRow.id,
      examId,
      finalScore,
      answers.length,
      globalCorrectCount,
      startTime,
      endTime,
      totalTimeSeconds || 0,
      violationCount || 0,
      isTimeUp ? "TIMED_OUT" : "COMPLETED",
    ]);

    const attemptId = attemptResult.rows[0].attempt_id;

    // D. 🟢 NEW: Save Subject-Specific Breakdown
    for (const [subjectName, stats] of Object.entries(subjectMap)) {
      const subScore =
        stats.total > 0
          ? parseFloat(((stats.correct / stats.total) * 100).toFixed(2))
          : 0;
      await client.query(
        `INSERT INTO attempt_subject_scores (attempt_id, subject_name, score, correct_count, total_questions)
             VALUES ($1, $2, $3, $4, $5)`,
        [attemptId, subjectName, subScore, stats.correct, stats.total],
      );
    }

    // E. Save Question-by-Question breakdown
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

    // F. Generate result code
    const uniqueIdRes = await client.query(
      `SELECT unique_id FROM exams_authorized WHERE id = $1`,
      [studentAuthRow.exam_auth_id],
    );
    const studentIdCode = `${uniqueIdRes.rows[0].unique_id}/${new Date(studentAuthRow.authorized_at).getFullYear().toString().slice(-2)}/${String(studentAuthRow.sequential_num).padStart(4, "0")}`;

    await client.query("COMMIT");

    return response.status(201).send({
      message: "Success",
      data: { attemptId, finalScore, studentIdCode },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Submission Error:", error.message);
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
  if (!userEmail) return response.status(401).send({ message: "Unauthorized" });

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

    // Fetch per-subject scores for display
    const subjectScoresRes = await client.query(
      `SELECT * FROM attempt_subject_scores WHERE attempt_id = ANY($1::int[])`,
      [attemptIds],
    );

    const scoresByAttempt = subjectScoresRes.rows.reduce((acc, row) => {
      acc[row.attempt_id] = acc[row.attempt_id] || [];
      acc[row.attempt_id].push(row);
      return acc;
    }, {});

    const finalData = summaryRows.map((s) => {
      const isReleased =
        !s.results_release_at || new Date(s.results_release_at) <= new Date();
      return {
        ...s,
        total_score: isReleased ? parseFloat(s.total_score) : null,
        subject_breakdown: isReleased
          ? scoresByAttempt[s.attempt_id] || []
          : [],
        is_released: isReleased,
        release_date: s.results_release_at,
      };
    });
    return response.status(200).send({ data: finalData });
  } catch (error) {
    return response.status(500).send({ message: "Fetch failed." });
  } finally {
    client.release();
  }
});

/**
 * 3. 🟢 UPDATED: Admin Summary Route (Sorted by Top Scorers)
 * Now returns subject_breakdown and integrity metrics.
 */
router.get(
  "/results/summary/:examId",
  validateSession,
  async (request, response) => {
    const examId = parseInt(request.params.examId);
    const client = await pool.connect();
    try {
      // 1. Fetch attempt summaries
      const summaryRows = (
        await client.query(
          `SELECT ea.*, u.name AS student_name, 
                ea_rec.unique_id || '/' || to_char(sa.authorized_at, 'YY') || '/' || LPAD(sa.sequential_num::text, 4, '0') AS student_id_code
         FROM exam_attempts ea 
         JOIN students_authorized sa ON ea.student_auth_id = sa.id
         JOIN exams_authorized ea_rec ON sa.exam_auth_id = ea_rec.id 
         LEFT JOIN users u ON sa.email = u.email
         WHERE ea.exam_id = $1 
         ORDER BY ea.total_score DESC, ea.time_taken_seconds ASC`,
          [examId],
        )
      ).rows;

      if (summaryRows.length === 0)
        return response.status(200).send({ data: [] });

      const attemptIds = summaryRows.map((r) => r.attempt_id);

      // 2. Fetch Question Details (Answered questions)
      const detailRows = (
        await client.query(
          `SELECT aa.attempt_id, aa.is_correct, aa.question_id, q.question_text, 
                o_chosen.option_text AS chosen_answer_text, o_correct.option_text AS correct_answer_text
         FROM attempt_answers aa 
         JOIN questions q ON aa.question_id = q.question_id
         LEFT JOIN options o_chosen ON aa.chosen_option_id = o_chosen.option_id
         LEFT JOIN options o_correct ON q.question_id = o_correct.question_id AND o_correct.is_correct = TRUE
         WHERE aa.attempt_id = ANY($1::int[])`,
          [attemptIds],
        )
      ).rows;

      // 3. Fetch Subject Breakdowns
      const subjectBreakdowns = (
        await client.query(
          `SELECT * FROM attempt_subject_scores WHERE attempt_id = ANY($1::int[])`,
          [attemptIds],
        )
      ).rows;

      // Map details and subject scores to their respective attempts
      const detailsMap = detailRows.reduce((acc, row) => {
        acc[row.attempt_id] = acc[row.attempt_id] || [];
        acc[row.attempt_id].push(row);
        return acc;
      }, {});

      const subjectsMap = subjectBreakdowns.reduce((acc, row) => {
        acc[row.attempt_id] = acc[row.attempt_id] || [];
        acc[row.attempt_id].push(row);
        return acc;
      }, {});

      // 4. Combine data and ensure no null arrays
      const finalData = summaryRows.map((s) => ({
        ...s,
        total_score: parseFloat(s.total_score) || 0,
        student_name: s.student_name || "Unknown Candidate",
        details: detailsMap[s.attempt_id] || [], // Ensure it's an array
        subject_breakdown: subjectsMap[s.attempt_id] || [], // Ensure it's an array
        has_violations: s.violation_count > 0,
      }));

      return response.status(200).send({ data: finalData });
    } catch (error) {
      console.error("Admin Fetch Error:", error);
      return response.status(500).send({ message: "Fetch error." });
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

    return response.status(200).send({
      hasTaken: attempts.length > 0,
      canTakeAgain: examInfo?.allow_multiple_attempts || attempts.length === 0,
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
