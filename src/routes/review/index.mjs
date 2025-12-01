import { Router } from "express";
import pool from "../../utils/helpers/db.mjs";
// Assuming you have a validateSession middleware to authenticate the user
import { validateSession } from "../../utils/middlewares/validateSession.mjs";

const router = Router();

/**
 * Route: POST /survey-feedback
 * Purpose: Saves student feedback/review data after exam submission.
 * Payload: { submissionId: string, enjoyed: string, feedback: string }
 * NOTE: submissionId here is the public student_id_code (e.g., 'UI/PM/25/0001').
 */
router.post("/survey-feedback", async (request, response) => {
  // SECURITY NOTE: In production, consider adding rate limiting here
  // or passing the JWT token to verify the user attempting to submit feedback.

  const { submissionId, enjoyed, feedback } = request.body;

  if (!submissionId || !enjoyed) {
    return response.status(400).send({
      message: "Missing required fields: submission ID or 'enjoyed' status.",
    });
  }

  // --- 1. Reverse Lookup Logic ---
  // Split the public ID code (e.g., 'UI/PM/25/0001') to get the sequential number and exam prefix
  const parts = submissionId.split("/");
  if (parts.length < 3) {
    return response.status(400).send({
      message:
        "Invalid submission ID format. Expected format like PREFIX/YY/NUMBER.",
    });
  }

  // Assuming sequential number is the last part (e.g., '0001')
  const sequentialNum = parseInt(parts[parts.length - 1], 10);
  // Unique ID Prefix is typically the first part(s), e.g., 'UI/PM'
  const uniqueIdPrefix = parts.slice(0, parts.length - 1).join("/");

  if (isNaN(sequentialNum)) {
    return response.status(400).send({
      message: "Invalid sequential number in submission ID.",
    });
  }

  const client = await pool.connect();
  let attemptId;

  try {
    // 2. Find the student_auth_id based on the sequential number and unique ID prefix
    const studentAuthQuery = `
            SELECT sa.id AS student_auth_id
            FROM students_authorized sa
            JOIN exams_authorized ea ON sa.exam_auth_id = ea.id
            -- NOTE: Unique ID Prefix must match exactly (case sensitive if unique_id is)
            WHERE sa.sequential_num = $1 AND ea.unique_id = $2; 
        `;
    const authResult = await client.query(studentAuthQuery, [
      sequentialNum,
      uniqueIdPrefix,
    ]);

    if (authResult.rows.length === 0) {
      return response.status(404).send({
        message: "Student authorization record not found via ID code.",
      });
    }
    const studentAuthId = authResult.rows[0].student_auth_id;

    // 3. Find the latest completed attempt for this student (we link feedback to the attempt)
    const attemptQuery = `
            SELECT attempt_id 
            FROM exam_attempts 
            WHERE student_auth_id = $1
            ORDER BY end_time DESC
            LIMIT 1;
        `;
    const attemptResult = await client.query(attemptQuery, [studentAuthId]);

    if (attemptResult.rows.length === 0) {
      return response.status(404).send({
        message: "No completed exam attempts found for this student.",
      });
    }
    attemptId = attemptResult.rows[0].attempt_id;

    // 4. Insert feedback into survey_feedback table (ON CONFLICT handles retries/updates)
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
      feedback || null, // Allow feedback to be null/empty
    ]);

    return response.status(201).send({
      message: "Feedback submitted successfully.",
      feedbackId: rows[0].feedback_id,
    });
  } catch (error) {
    console.error("Error submitting survey feedback:", error);
    return response.status(500).send({
      message: "Internal server error during feedback submission.",
      error: error.message,
    });
  } finally {
    client.release();
  }
});

/**
 * Route: GET /reviews
 * Purpose: Retrieves all survey feedback/reviews for the Admin Dashboard.
 * Requires: validateSession (Admin access protection)
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
          u.name AS student_name,
          sa.email AS student_email,
          -- Construct the public student ID code
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

    // Ensure the data keys match the frontend Review interface exactly
    const reviewsData = rows.map((row) => ({
      feedback_id: row.feedback_id,
      enjoyed: row.enjoyed,
      feedback_text: row.feedback_text,
      submitted_at: row.submitted_at,
      exam_title: row.exam_title,
      student_name: row.student_name || "Unregistered User", // Provide a fallback
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
