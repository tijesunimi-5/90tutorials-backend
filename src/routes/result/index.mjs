import { Router } from "express";
import pool from "../../utils/helpers/db.mjs";
import { validateSession } from "../../utils/middlewares/validateSession.mjs";

const router = Router();

/**
 * Helper function to retrieve all correct options for a given exam.
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


// --- POST Submission Route (Authoritative Scoring & Saving) ---
router.post("/results/submit", validateSession, async (request, response) => {
  const { examId, answers, endTime, isTimeUp } = request.body;
  const studentEmail = request.user?.email;

  if (!studentEmail || !examId || !Array.isArray(answers) || !endTime) {
    return response.status(400).send({
      message: "Missing required fields: email, examId, answers, or endTime.",
    });
  }

  const client = await pool.connect();
  let studentAuthId;

  // 💡 FIX 1: Initialize all scoring variables outside the try block
  let correctAnswers = 0;
  const totalQuestions = answers.length;
  let finalScore = 0.0;
  let answeredDetails = [];
  let studentIdCode = null; // Initialize studentIdCode

  try {
    await client.query("BEGIN");

    // 1. Look up the student_auth_id
    const studentAuthQuery = `SELECT id, exam_auth_id, authorized_at, sequential_num FROM students_authorized WHERE LOWER(email) = LOWER($1);`;
    const studentAuthResult = await client.query(studentAuthQuery, [
      studentEmail,
    ]);

    if (studentAuthResult.rows.length === 0) {
      throw new Error("Student is not authorized to take this exam.");
    }
    const studentAuthRow = studentAuthResult.rows[0];
    studentAuthId = studentAuthRow.id;

    // --- SCORING LOGIC START ---

    // 2. Retrieve the authoritative answer key for the exam
    const answerKey = await getExamAnswerKey(examId, client);

    // 3. Compare student answers against the key
    answeredDetails = answers.map((answer) => {
      const questionId = answer.questionId;
      const chosenOptionId = answer.chosenOptionId;
      const correctOptionId = answerKey[questionId];

      // Determine correctness
      const isCorrect =
        chosenOptionId !== undefined &&
        chosenOptionId !== null &&
        Number(chosenOptionId) === Number(correctOptionId);

      if (isCorrect) {
        correctAnswers++;
      }

      return {
        ...answer,
        isCorrect: isCorrect,
        scoreAwarded: isCorrect ? 1.0 : 0.0,
      };
    });

    // 4. Calculate final score (as a percentage)
    if (totalQuestions > 0) {
      finalScore = (correctAnswers / totalQuestions) * 100;
      finalScore = parseFloat(finalScore.toFixed(2));
    }
    // --- SCORING LOGIC END ---

    // 5. Attempt to Insert into exam_attempts
    const attemptQuery = `
      INSERT INTO exam_attempts (
          student_auth_id, exam_id, total_score, total_questions, correct_answers, end_time, submission_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING attempt_id;
    `;

    const submissionStatus = isTimeUp ? "TIMED_OUT" : "COMPLETED";

    const attemptResult = await client.query(attemptQuery, [
      studentAuthId, // $1
      examId, // $2
      finalScore, // $3
      totalQuestions, // $4
      correctAnswers, // $5
      endTime, // $6
      submissionStatus, // $7
    ]);
    const attemptId = attemptResult.rows[0].attempt_id;

    // 6. Insert individual attempt answers (unchanged logic)
    if (answeredDetails.length > 0) {
      const answerValues = answeredDetails
        .map((detail, index) => {
          const baseIndex = index * 5 + 1;
          return `($${baseIndex}, $${baseIndex + 1}, $${baseIndex + 2}, $${
            baseIndex + 3
          }, $${baseIndex + 4})`;
        })
        .join(", ");

      const answerParams = answeredDetails.flatMap((detail) => [
        attemptId,
        detail.questionId,
        detail.chosenOptionId,
        detail.isCorrect,
        detail.scoreAwarded,
      ]);

      const insertAnswersQuery = `
            INSERT INTO attempt_answers (
                attempt_id, question_id, chosen_option_id, is_correct, score_awarded
            ) VALUES ${answerValues};
        `;
      await client.query(insertAnswersQuery, answerParams);
    }

    // 7. FETCH/CONSTRUCT STUDENT ID CODE (Required by Frontend)
    const examAuthId = studentAuthRow.exam_auth_id;
    const authAt = studentAuthRow.authorized_at;
    const sequentialNum = studentAuthRow.sequential_num;

    // Fetch the unique_id from exams_authorized
    const uniqueIdQuery = `SELECT unique_id FROM exams_authorized WHERE id = $1;`;
    const uniqueIdResult = await client.query(uniqueIdQuery, [examAuthId]);
    const uniqueId = uniqueIdResult.rows[0]?.unique_id || "XXX";

    // Construct the public student ID code using the format from the summary route
    // Format: unique_id/YY/LPAD(sequential_num, 4, '0')
    const authYear = new Date(authAt).getFullYear().toString().slice(-2);
    const paddedNum = String(sequentialNum).padStart(4, "0");
    studentIdCode = `${uniqueId}/${authYear}/${paddedNum}`;

    await client.query("COMMIT");

    // 8. CRITICAL FIX: Include studentIdCode in the response data
    return response.status(201).send({
      message: "Exam results saved successfully.",
      data: {
        attemptId: attemptId,
        finalScore: finalScore,
        studentIdCode: studentIdCode, // <-- NOW INCLUDED
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error submitting exam results:", error);

    // CRITICAL FIX: Handle the duplicate key violation (Code '23505')
    if (
      error.code === "23505" &&
      error.constraint === "exam_attempts_student_auth_id_exam_id_key"
    ) {
      if (studentAuthId) {
        // Note: Use pool here as client might be in a bad state after ROLLBACK
        const existingAttemptQuery = `
                SELECT attempt_id, total_score 
                FROM exam_attempts 
                WHERE student_auth_id = $1 AND exam_id = $2;
            `;
        const existingAttempt = await pool.query(existingAttemptQuery, [
          studentAuthId,
          examId,
        ]);

        if (existingAttempt.rows.length > 0) {
          const existing = existingAttempt.rows[0];
          return response.status(409).send({
            message: "Exam already submitted.",
            data: {
              attemptId: existing.attempt_id,
              finalScore: parseFloat(existing.total_score),
            },
          });
        }
      }
    }

    // Handle all other errors
    const status = error.message.includes("authorized") ? 403 : 500;
    return response
      .status(status)
      .send({ message: "Failed to save exam results.", error: error.message });
  } finally {
    // Client is ONLY released here, ensuring it happens exactly once.
    if (client) client.release();
  }
});

// --- 2. GET Check Route (Frontend Retake Prevention) ---

router.get("/check/:examId", validateSession, async (request, response) => {
  const examId = request.params.examId;

  // 💡 MODIFICATION 2: Use optional chaining for defensive access
  const userEmail = request.user?.email;

  if (!userEmail) {
    return response
      .status(401)
      .send({ message: "User email required for authorization check." });
  }

  const client = await pool.connect();
  let studentAuthId;
  try {
    const studentAuthQuery = `SELECT id FROM students_authorized WHERE LOWER(email) = LOWER($1);`;
    const studentAuthResult = await client.query(studentAuthQuery, [userEmail]);

    if (studentAuthResult.rows.length === 0) {
      return response.status(200).send({ hasTaken: false, attemptId: null });
    }
    studentAuthId = studentAuthResult.rows[0].id;

    const query = `
          SELECT attempt_id FROM exam_attempts
          WHERE student_auth_id = $1 
          AND exam_id = $2 
          AND submission_status IN ('COMPLETED', 'TIMED_OUT');
        `;
    const { rows } = await client.query(query, [studentAuthId, examId]);

    return response.status(200).send({
      hasTaken: rows.length > 0,
      attemptId: rows.length > 0 ? rows[0].attempt_id : null,
    });
  } catch (error) {
    console.error("Error checking exam status:", error);
    return response
      .status(500)
      .send({ message: "Failed to check exam status." });
  } finally {
    client.release();
  }
});

// --- 3. ADMIN DASHBOARD ENDPOINTS ---

router.get("/results/exams", validateSession, async (request, response) => {
  // ... (No changes needed here)
  try {
    const query = `SELECT exam_id, title FROM examinations ORDER BY title;`;
    const { rows } = await pool.query(query);
    return response.status(200).send({ data: rows });
  } catch (error) {
    console.error("Error fetching exams list:", error);
    return response.status(500).send({ message: "Failed to fetch exam list." });
  }
});

router.get(
  "/results/summary/:examId",
  validateSession,
  async (request, response) => {
    const examId = parseInt(request.params.examId);
    if (isNaN(examId)) {
      return response
        .status(400)
        .send({ message: "Invalid exam ID provided." });
    }

    const client = await pool.connect();
    try {
      // 1. Fetch all attempt summaries for the given exam, joining necessary tables
      const summaryQuery = `
          SELECT
              ea.attempt_id,
              u.name AS student_name,
              -- Construct the public student ID code
              ea_rec.unique_id || '/' || to_char(sa.authorized_at, 'YY') || '/' || LPAD(sa.sequential_num::text, 4, '0') AS student_id_code,
              ea.total_score,
              ea.correct_answers,
              ea.total_questions,
              ea.end_time,
              ea.submission_status
          FROM exam_attempts ea
          JOIN students_authorized sa ON ea.student_auth_id = sa.id
          JOIN exams_authorized ea_rec ON sa.exam_auth_id = ea_rec.id
          -- Join users table to get the student's registered name
          LEFT JOIN users u ON sa.email = u.email
          WHERE ea.exam_id = $1
          ORDER BY ea.end_time DESC;
        `;
      const { rows: summaryRows } = await client.query(summaryQuery, [examId]);

      if (summaryRows.length === 0) {
        return response.status(200).send({ data: [] });
      }

      // 2. Fetch detailed answers for all retrieved attempts
      const attemptIds = summaryRows.map((row) => row.attempt_id);

      const detailQuery = `
          SELECT 
              aa.attempt_id, 
              aa.is_correct, 
              aa.question_id,
              q.question_text,
              o_chosen.option_text AS chosen_answer_text,
              o_correct.option_text AS correct_answer_text
          FROM attempt_answers aa
          JOIN questions q ON aa.question_id = q.question_id
          LEFT JOIN options o_chosen ON aa.chosen_option_id = o_chosen.option_id
          LEFT JOIN options o_correct ON q.question_id = o_correct.question_id AND o_correct.is_correct = TRUE
          WHERE aa.attempt_id = ANY($1::int[])
          ORDER BY aa.attempt_id, aa.question_id;
        `;
      const { rows: detailRows } = await client.query(detailQuery, [
        attemptIds,
      ]);

      // 3. Map details back to the summary rows
      const attemptsMap = detailRows.reduce((acc, row) => {
        if (!acc[row.attempt_id]) {
          acc[row.attempt_id] = [];
        }
        acc[row.attempt_id].push(row);
        return acc;
      }, {});

      // 4. Combine and send data
      const finalData = summaryRows.map((summary) => ({
        ...summary,
        total_score: parseFloat(summary.total_score),
        details: attemptsMap[summary.attempt_id] || [],
        // Ensure student_name defaults to email if not found in users table
        student_name: summary.student_name || "Unknown User",
      }));

      return response.status(200).send({ data: finalData });
    } catch (error) {
      console.error(
        `Error fetching results summary for exam ${examId}:`,
        error
      );
      return response.status(500).send({
        message: "Failed to fetch exam summary data.",
        error: error.message,
      });
    } finally {
      client.release();
    }
  }
);

/**
 * Gets all attempts for the currently logged-in student.
 * Route: GET /results/student/attempts
 */
// 🟢 CRITICAL FIX: Added validateSession middleware
router.get("/student/attempts", validateSession, async (request, response) => {
  // We rely on email being populated by validateSession middleware

  // 💡 MODIFICATION 3: Use optional chaining for defensive access
  const userEmail = request.user?.email;

  if (!userEmail) {
    // This is the line that caused the error. Now it returns a proper 401.
    return response.status(401).send({ message: "User email required." });
  }

  const client = await pool.connect();
  let studentAuthId;

  try {
    // 1. Look up the studentAuthId (PK from students_authorized)
    const studentAuthQuery = `
          SELECT id FROM students_authorized WHERE LOWER(email) = LOWER($1);
        `;
    const studentAuthResult = await client.query(studentAuthQuery, [userEmail]);

    if (studentAuthResult.rows.length === 0) {
      // Student is authenticated but not authorized for any exams
      return response.status(200).send({ data: [] });
    }
    studentAuthId = studentAuthResult.rows[0].id;

    // 2. Fetch all attempt summaries for this student
    const summaryQuery = `
          SELECT
              ea.attempt_id,
              ea.total_score,
              ea.correct_answers,
              ea.total_questions,
              ea.end_time,
              ea.submission_status,
              e.title AS exam_title
          FROM exam_attempts ea
          JOIN examinations e ON ea.exam_id = e.exam_id
          WHERE ea.student_auth_id = $1
          ORDER BY ea.end_time DESC;
        `;
    const { rows: summaryRows } = await client.query(summaryQuery, [
      studentAuthId,
    ]);

    if (summaryRows.length === 0) {
      return response.status(200).send({ data: [] });
    }

    // 3. Fetch detailed answers for all retrieved attempts
    const attemptIds = summaryRows.map((row) => row.attempt_id);

    const detailQuery = `
          SELECT 
              aa.attempt_id, 
              aa.is_correct, 
              aa.question_id,
              q.question_text,
              o_chosen.option_text AS chosen_answer_text,
              o_correct.option_text AS correct_answer_text
          FROM attempt_answers aa
          JOIN questions q ON aa.question_id = q.question_id
          LEFT JOIN options o_chosen ON aa.chosen_option_id = o_chosen.option_id
          LEFT JOIN options o_correct ON q.question_id = o_correct.question_id AND o_correct.is_correct = TRUE
          WHERE aa.attempt_id = ANY($1::int[])
          ORDER BY aa.attempt_id, aa.question_id;
        `;
    const { rows: detailRows } = await client.query(detailQuery, [attemptIds]);

    // 4. Map details back to the summary rows
    const attemptsMap = detailRows.reduce((acc, row) => {
      if (!acc[row.attempt_id]) {
        acc[row.attempt_id] = [];
      }
      acc[row.attempt_id].push(row);
      return acc;
    }, {});

    const finalData = summaryRows.map((summary) => ({
      ...summary,
      // Convert score string to float/number for frontend consumption
      total_score: parseFloat(summary.total_score),
      details: attemptsMap[summary.attempt_id] || [],
    }));

    return response.status(200).send({ data: finalData });
  } catch (error) {
    console.error("Error fetching student attempts:", error);
    return response.status(500).send({
      message: "Failed to fetch student attempts.",
      error: error.message,
    });
  } finally {
    client.release();
  }
});

// --- 4. GET Attempts Route (General History - Kept for legacy/admin) ---

router.get("/attempts", validateSession, async (request, response) => {
  // ... (No changes needed here)
  // ... (rest of the /attempts logic)
});

export default router;
