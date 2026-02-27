import { Router } from "express";
import pool from "../../utils/helpers/db.mjs";
import { validateSession } from "../../utils/middlewares/validateSession.mjs";

const router = Router();

/**
 * Route: POST /survey-feedback
 * Purpose: Saves student feedback/review data after exam submission.
 * Payload: { submissionId: string, enjoyed: string, feedback: string }
 * NOTE: submissionId is the public student_id_code (e.g., 'UI/PM/25/0001').
 */
router.post("/survey-feedback", async (request, response) => {
  const { submissionId, enjoyed, feedback } = request.body;

  // Basic validation
  if (!submissionId || !enjoyed) {
    return response.status(400).send({
      message: "Missing required fields: submission ID or 'enjoyed' status.",
    });
  }

  // Handle parsing for IDs like "UI/PM/25/0005"
  const parts = submissionId.split("/");

  if (parts.length < 3) {
    return response.status(400).send({
      message:
        "Invalid submission ID format. Expected at least PREFIX/YY/NUMBER.",
    });
  }

  // 1. Get the sequential number (the last segment)
  const sequentialNum = parseInt(parts[parts.length - 1], 10);

  // 2. Get the uniqueIdPrefix (Everything BEFORE the year and the number)
  // Logic: parts.slice(0, -2) grabs everything before the last two segments (Year/Num)
  const uniqueIdPrefix = parts.slice(0, parts.length - 2).join("/");

  if (isNaN(sequentialNum)) {
    return response.status(400).send({
      message: "Invalid sequential number in submission ID.",
    });
  }

  let client;
  try {
    client = await pool.connect();

    // Find the internal student_auth_id using the public sequential number and exam prefix
    const studentAuthQuery = `
            SELECT sa.id AS student_auth_id
            FROM students_authorized sa
            JOIN exams_authorized ea ON sa.exam_auth_id = ea.id
            WHERE sa.sequential_num = $1 
            AND ea.unique_id = $2; 
        `;

    const authResult = await client.query(studentAuthQuery, [
      sequentialNum,
      uniqueIdPrefix,
    ]);

    if (authResult.rows.length === 0) {
      return response.status(404).send({
        message: `Student record not found for ID: ${submissionId}.`,
      });
    }

    const studentAuthId = authResult.rows[0].student_auth_id;

    // Find the student's most recent exam attempt
    const attemptQuery = `
            SELECT attempt_id FROM exam_attempts 
            WHERE student_auth_id = $1
            ORDER BY end_time DESC LIMIT 1;
        `;
    const attemptResult = await client.query(attemptQuery, [studentAuthId]);

    if (attemptResult.rows.length === 0) {
      return response.status(404).send({
        message: "No completed exam attempts found for this student.",
      });
    }

    const attemptId = attemptResult.rows[0].attempt_id;

    // Insert or Update the feedback for this specific attempt
    const insertQuery = `
            INSERT INTO survey_feedback (attempt_id, enjoyed, feedback_text)
            VALUES ($1, $2, $3)
            ON CONFLICT (attempt_id) 
            DO UPDATE SET 
                enjoyed = EXCLUDED.enjoyed, 
                feedback_text = EXCLUDED.feedback_text,
                submitted_at = NOW()
            RETURNING feedback_id;
        `;
    const { rows } = await client.query(insertQuery, [
      attemptId,
      enjoyed,
      feedback || null,
    ]);

    return response.status(201).send({
      message: "Feedback submitted successfully.",
      feedbackId: rows[0].feedback_id,
    });
  } catch (error) {
    console.error("Error submitting survey feedback:", error);
    if (!response.headersSent) {
      return response.status(500).send({
        message: "Internal server error.",
        error: error.message,
      });
    }
  } finally {
    if (client) client.release();
  }
});

/**
 * Route: GET /results/reviews
 * Purpose: Retrieves all survey feedback/reviews for the Admin Dashboard.
 */
router.get("/results/reviews", validateSession, async (request, response) => {
  try {
    const query = `
      SELECT
          sf.feedback_id,
          sf.enjoyed,
          sf.feedback_text,
          sf.submitted_at,
          e.title AS exam_title,
          COALESCE(u.name, sa.email) AS student_name, -- 🟢 Fallback to email if name is null
          sa.email AS student_email,
          ea_rec.unique_id || '/' || to_char(sa.authorized_at, 'YY') || '/' || LPAD(sa.sequential_num::text, 4, '0') AS student_id_code
      FROM survey_feedback sf
      JOIN exam_attempts att ON sf.attempt_id = att.attempt_id
      JOIN examinations e ON att.exam_id = e.exam_id
      JOIN students_authorized sa ON att.student_auth_id = sa.id
      JOIN exams_authorized ea_rec ON sa.exam_auth_id = ea_rec.id
      LEFT JOIN users u ON sa.email = u.email
      ORDER BY sf.submitted_at DESC;
    `;
    const { rows } = await pool.query(query);

    const reviewsData = rows.map((row) => ({
      feedback_id: row.feedback_id,
      enjoyed: row.enjoyed,
      feedback_text: row.feedback_text,
      submitted_at: row.submitted_at,
      exam_title: row.exam_title,
      student_name: row.student_name, // 🟢 Now contains either name or email
      student_email: row.student_email,
      student_id_code: row.student_id_code,
    }));

    return response.status(200).send({ data: reviewsData });
  } catch (error) {
    console.error("Error fetching reviews:", error);
    return response.status(500).send({
      message: "Failed to fetch survey reviews.",
      error: error.message,
    });
  }
});

export default router;
