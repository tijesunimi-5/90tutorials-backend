import { Router } from "express";
import pool from "../../utils/helpers/db.mjs";
import { validateSession } from "../../utils/middlewares/validateSession.mjs";

const router = Router();

/**
 * Helper function to retrieve all correct options for a given exam,
 * optimizing the scoring process.
 * Returns a map: { question_id: correct_option_id }
 */
async function getExamAnswerKey(examId, client) {
  const query = `
        SELECT 
            q.question_id, 
            o.option_id AS correct_option_id
        FROM questions q
        JOIN subjects s ON q.subject_id = s.subject_id
        JOIN examinations e ON s.exam_id = e.exam_id
        JOIN options o ON q.question_id = o.question_id
        WHERE e.exam_id = $1 AND o.is_correct = TRUE;
    `;
  const { rows } = await client.query(query, [examId]);

  const answerKey = {};
  rows.forEach((row) => {
    answerKey[row.question_id] = row.correct_option_id;
  });
  return answerKey;
}

/**
 * Saves a student's final exam results, score, and individual answers.
 * Route: POST /results/submit
 * Payload: {
 * studentAuthId: number,  // Internal PK from students_authorized
 * examId: number,         // PK from examinations
 * answers: [{ questionId: number, chosenOptionId: number | null }]
 * }
 */
router.post("/results/submit", validateSession, async (request, response) => {
  const { studentAuthId, examId, answers, endTime } = request.body;

  // Basic validation
  if (!studentAuthId || !examId || !Array.isArray(answers) || !endTime) {
    return response.status(400).send({
      message:
        "Missing required fields: studentAuthId, examId, answers, or endTime.",
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Get the authoritative answer key and total questions
    const answerKey = await getExamAnswerKey(examId, client);
    const totalQuestions = Object.keys(answerKey).length;
    if (totalQuestions === 0) {
      throw new Error("Exam has no questions defined.");
    }

    let correctAnswers = 0;
    let totalScore = 0;

    // Assume score per question is 1 point for now (100 / totalQuestions)
    const scorePerQuestion = 100 / totalQuestions;

    const answersToInsert = [];

    // 2. Score the answers
    for (const answer of answers) {
      const { questionId, chosenOptionId } = answer;
      const isCorrect = chosenOptionId === answerKey[questionId];
      const scoreAwarded = isCorrect ? scorePerQuestion : 0;

      if (isCorrect) {
        correctAnswers++;
        totalScore += scoreAwarded;
      }

      answersToInsert.push({
        questionId,
        chosenOptionId,
        isCorrect,
        scoreAwarded,
      });
    }

    // 3. Insert into exam_attempts (Summary)
    const attemptQuery = `
            INSERT INTO exam_attempts (
                student_auth_id, exam_id, total_score, total_questions, correct_answers, end_time, submission_status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING attempt_id;
        `;
    const attemptResult = await client.query(attemptQuery, [
      studentAuthId,
      examId,
      Math.round(totalScore * 100) / 100, // Round to two decimal places
      totalQuestions,
      correctAnswers,
      endTime,
      "COMPLETED",
    ]);
    const attemptId = attemptResult.rows[0].attempt_id;

    // 4. Insert into attempt_answers (Details)
    const detailInsertPromises = answersToInsert.map((a) => {
      const detailQuery = `
                INSERT INTO attempt_answers (attempt_id, question_id, chosen_option_id, is_correct, score_awarded)
                VALUES ($1, $2, $3, $4, $5);
            `;
      return client.query(detailQuery, [
        attemptId,
        a.questionId,
        a.chosenOptionId,
        a.isCorrect,
        a.scoreAwarded,
      ]);
    });

    await Promise.all(detailInsertPromises);

    await client.query("COMMIT");

    return response.status(201).send({
      message: "Exam results saved successfully.",
      data: {
        attemptId: attemptId,
        finalScore: Math.round(totalScore * 100) / 100,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error submitting exam results:", error);
    return response
      .status(500)
      .send({ message: "Failed to save exam results.", error: error.message });
  } finally {
    client.release();
  }
});

router.get("/attempts", validateSession, async (request, response) => {
  // We want to link all the way back to the student's name and email
  // and the exam title for the admin view.
  const query = `
        SELECT
            ea.attempt_id,
            ea.total_score,
            ea.correct_answers,
            ea.total_questions,
            ea.submission_status,
            ea.end_time,
            
            e.exam_id,
            e.title AS exam_title,
            
            u.id AS user_id,
            u.name AS student_name,
            u.email AS student_email
            
        FROM exam_attempts ea
        JOIN examinations e ON ea.exam_id = e.exam_id
        JOIN students_authorized sa ON ea.student_auth_id = sa.id
        JOIN users u ON sa.email = u.email
        -- Add WHERE clauses here if filters are passed in request.query
        ORDER BY ea.end_time DESC;
    `;

  try {
    const { rows } = await pool.query(query);

    return response.status(200).send({
      message: "Exam attempts fetched successfully.",
      data: rows,
    });
  } catch (error) {
    console.error("Error fetching exam attempts:", error);
    return response
      .status(500)
      .send({
        message: "Failed to fetch exam attempts.",
        error: error.message,
      });
  }
});

export default router;
