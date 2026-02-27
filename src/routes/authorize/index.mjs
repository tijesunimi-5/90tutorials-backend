// authorize-routes.mjs (FULL & CORRECTED WITH BATCH LOGIC)

import { Router } from "express";
import { resolve } from "path";
import fs from "fs";
import {
  generateRandomString,
  constructStudentIdCode,
} from "../../utils/helpers/generateID.mjs";
import { validateSession } from "../../utils/middlewares/validateSession.mjs";
import pool from "../../utils/helpers/db.mjs";
import { updateAuthorizedExamId } from "../../utils/helpers/helper.mjs";

const router = Router();

// ----------------------------------------------------------------------
//                         PG UTILITY FUNCTIONS
// ----------------------------------------------------------------------

/**
 * Checks if the exam exists in the main 'examinations' catalog.
 */
async function checkExamExistsPG(title) {
  const query = `SELECT 1 FROM examinations WHERE title = $1`;
  const result = await pool.query(query, [title]);
  return result.rows.length > 0;
}

/**
 * Fetches a registered user from the 'users' table by email.
 */
async function getRegisteredStudentByEmail(email) {
  const query = `
        SELECT id, email, name 
        FROM users 
        WHERE email = $1;
    `;
  try {
    const result = await pool.query(query, [email]);
    return result.rows[0] || null;
  } catch (error) {
    console.error("Error fetching registered user:", error);
    throw error;
  }
}

/**
 * Utility to get all authorized exams and their students, constructing the student ID.
 */
async function getFileStudentsDataPG() {
  const query = `
      SELECT
        ea.unique_id AS id,
        ea.exam_title AS exam,
        COALESCE(
          json_agg(
            json_build_object(
              'id', 
              ea.unique_id || '/' || to_char(CURRENT_TIMESTAMP, 'YY') || '/' || LPAD(sa.sequential_num::text, 4, '0'),
              'email', sa.email
            )
          ) FILTER (WHERE sa.id IS NOT NULL),
          '[]'::json
        ) AS students
        FROM
          exams_authorized ea
        LEFT JOIN
          students_authorized sa ON ea.id = sa.exam_auth_id
        GROUP BY
          ea.id, ea.unique_id, ea.exam_title;
    `;
  const { rows } = await pool.query(query);
  return rows;
}

/**
 * Utility to get a single authorized exam and its students.
 */
async function getAuthorizeExamPG(title) {
  const parsedTitle = title.toLowerCase();
  const query = `
        SELECT
            ea.id,
            ea.unique_id,
            ea.exam_title AS exam,
            COALESCE(
                json_agg(
                    json_build_object(
                        'id', 
                        ea.unique_id || '/' || to_char(CURRENT_TIMESTAMP, 'YY') || '/' || LPAD(sa.sequential_num::text, 4, '0'),
                        'email', sa.email
                    )
                ) FILTER (WHERE sa.id IS NOT NULL),
                '[]'::json
            ) AS students
        FROM
            exams_authorized ea
        LEFT JOIN
            students_authorized sa ON ea.id = sa.exam_auth_id
        WHERE
            LOWER(ea.exam_title) = $1
        GROUP BY
            ea.id, ea.unique_id, ea.exam_title;
    `;
  const { rows } = await pool.query(query, [parsedTitle]);
  return rows[0];
}

// ----------------------------------------------------------------------
//                                ROUTES
// ----------------------------------------------------------------------

// GET /authorized
router.get("/authorized", validateSession, async (request, response) => {
  try {
    const fileData = await getFileStudentsDataPG();
    if (fileData.length === 0) {
      return response.status(404).send({ message: "No Data to display" });
    }
    return response
      .status(200)
      .send({ message: "Fetch successful!", data: fileData });
  } catch (error) {
    return response
      .status(500)
      .send({ message: "An error occurred fetching data" });
  }
});

// POST /authorize-student (Exam Config)
router.post(
  "/authorize-student",
  validateSession,
  async (request, response) => {
    const { title, id } = request.body;
    if (!title || !id)
      return response
        .status(400)
        .send({ message: "Must provide valid title and ID." });

    const examExists = await checkExamExistsPG(title);
    if (!examExists)
      return response
        .status(404)
        .send({ message: `Exam '${title}' not found.` });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const sequenceName = `seq_${id.toLowerCase().replace(/[^a-z0-9_]/g, "")}`;
      await client.query(
        `CREATE SEQUENCE IF NOT EXISTS ${sequenceName} START WITH 1 INCREMENT BY 1`,
      );

      const { rows } = await client.query(
        `INSERT INTO exams_authorized (unique_id, exam_title, id_sequence_name) VALUES ($1, $2, $3) RETURNING unique_id AS id, exam_title AS exam`,
        [id, title, sequenceName],
      );

      await client.query("COMMIT");
      return response.status(201).send({
        message: "Sequence created",
        data: { ...rows[0], students: [] },
      });
    } catch (error) {
      await client.query("ROLLBACK");
      if (error.code === "23505")
        return response.status(409).send({ message: "Record already exists." });
      return response.status(500).send({ message: "Server error" });
    } finally {
      client.release();
    }
  },
);

/**
 * 🟢 NEW: POST /authorize/batch
 * Authorizes multiple students at once.
 */
router.post("/authorize/batch", validateSession, async (request, response) => {
  const { examTitle, emails } = request.body;
  const emailsToAdd = Array.isArray(emails) ? emails : [emails];

  if (!examTitle || emailsToAdd.length === 0) {
    return response
      .status(400)
      .send({ message: "Exam title and emails required." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Get Exam Details
    const examRes = await client.query(
      `SELECT id, id_sequence_name FROM exams_authorized WHERE LOWER(exam_title) = LOWER($1)`,
      [examTitle],
    );
    if (examRes.rows.length === 0)
      throw new Error("Exam not authorized in config.");
    const { id: examAuthId, id_sequence_name } = examRes.rows[0];

    const processedCount = 0;

    for (const email of emailsToAdd) {
      // Check if user is registered in 'users' table
      const user = await getRegisteredStudentByEmail(email);
      if (!user) continue; // Skip unregistered

      // Get next sequence number
      const seqRes = await client.query(`SELECT nextval($1) AS num`, [
        id_sequence_name,
      ]);
      const nextNum = seqRes.rows[0].num;

      // Insert into students_authorized
      await client.query(
        `INSERT INTO students_authorized (exam_auth_id, email, sequential_num) 
         VALUES ($1, LOWER($2), $3) 
         ON CONFLICT (exam_auth_id, email) DO NOTHING`,
        [examAuthId, email, nextNum],
      );
    }

    await client.query("COMMIT");
    return response
      .status(201)
      .send({ message: "Batch authorization complete." });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    return response.status(500).send({ message: error.message });
  } finally {
    client.release();
  }
});

/**
 * 🟢 NEW: POST /authorize/batch-remove
 * Revokes authorization for multiple students at once.
 */
router.post(
  "/authorize/batch-remove",
  validateSession,
  async (request, response) => {
    const { examTitle, emails } = request.body;
    if (!examTitle || !Array.isArray(emails)) {
      return response
        .status(400)
        .send({ message: "Exam title and email list required." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const examRes = await client.query(
        `SELECT id FROM exams_authorized WHERE LOWER(exam_title) = LOWER($1)`,
        [examTitle],
      );
      if (examRes.rows.length === 0) throw new Error("Exam config not found.");

      await client.query(
        `DELETE FROM students_authorized WHERE exam_auth_id = $1 AND email = ANY($2)`,
        [examRes.rows[0].id, emails],
      );

      await client.query("COMMIT");
      return response
        .status(200)
        .send({ message: "Access revoked for selected students." });
    } catch (error) {
      await client.query("ROLLBACK");
      return response.status(500).send({ message: error.message });
    } finally {
      client.release();
    }
  },
);

// POST /authorize-student/email (Original Single/Email add logic kept for compatibility)
router.post(
  "/authorize-student/email",
  validateSession,
  async (request, response) => {
    const { emails, title } = request.body;
    const emailsToAdd = Array.isArray(emails) ? emails : [emails];
    if (!emailsToAdd || emailsToAdd.length === 0)
      return response.status(400).send({ message: "Provide email(s)" });

    const authorized = await getAuthorizeExamPG(title);
    if (!authorized)
      return response.status(404).send({ message: "Exam record not found." });

    const { unique_id, id_sequence_name } = (
      await pool.query(
        `SELECT unique_id, id_sequence_name FROM exams_authorized WHERE id = $1`,
        [authorized.id],
      )
    ).rows[0];

    const existingEmails = authorized.students.map((s) =>
      s.email.toLowerCase(),
    );
    const emailsToProcess = emailsToAdd.filter(
      (email) => !existingEmails.includes(email.toLowerCase()),
    );

    if (emailsToProcess.length === 0)
      return response
        .status(200)
        .send({ message: "Already authorized.", data: authorized });

    const studentResults = await Promise.all(
      emailsToProcess.map((email) =>
        getRegisteredStudentByEmail(email).then((user) => ({ email, user })),
      ),
    );
    const registeredEmailsToAuthorize = studentResults
      .filter((result) => result.user)
      .map((result) => result.email);
    const unregisteredEmails = studentResults
      .filter((result) => !result.user)
      .map((result) => result.email);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const studentEmail of registeredEmailsToAuthorize) {
        const nextValResult = await client.query(
          `SELECT nextval($1) AS next_num`,
          [id_sequence_name],
        );
        await client.query(
          `INSERT INTO students_authorized (sequential_num, email, exam_auth_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [nextValResult.rows[0].next_num, studentEmail, authorized.id],
        );
      }
      await client.query("COMMIT");
      const updated = await getAuthorizeExamPG(title);
      return response.status(200).send({
        data: updated,
        warning:
          unregisteredEmails.length > 0 ? "Skipped unregistered users." : null,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      return response.status(500).send({ message: "Transaction error" });
    } finally {
      client.release();
    }
  },
);

// PATCH /authorize-student (Update Email)
router.patch(
  "/authorize-student",
  validateSession,
  async (request, response) => {
    const { title, students: newEmail, id: studentIdCode } = request.body;
    if (!studentIdCode || !title || !newEmail)
      return response.status(400).send({ message: "Missing fields" });

    const registeredUser = await getRegisteredStudentByEmail(newEmail);
    if (!registeredUser)
      return response.status(400).send({ message: "Email not registered." });

    const examAuthorized = await getAuthorizeExamPG(title);
    const sequentialNum = parseInt(studentIdCode.split("/").pop(), 10);

    const { rowCount } = await pool.query(
      `UPDATE students_authorized SET email = $1 WHERE sequential_num = $2 AND exam_auth_id = $3`,
      [newEmail, sequentialNum, examAuthorized.id],
    );
    return rowCount > 0
      ? response.status(200).send({ message: "Updated." })
      : response.status(404).send({ message: "User not found." });
  },
);

// DELETE /authorize-student
router.delete(
  "/authorize-student",
  validateSession,
  async (request, response) => {
    const { title, id: studentIdCode } = request.body;
    const examAuthorized = await getAuthorizeExamPG(title);
    const sequentialNum = parseInt(studentIdCode.split("/").pop(), 10);

    const { rowCount } = await pool.query(
      `DELETE FROM students_authorized WHERE sequential_num = $1 AND exam_auth_id = $2`,
      [sequentialNum, examAuthorized.id],
    );
    return rowCount > 0
      ? response.status(200).send({ message: "Deleted." })
      : response.status(404).send({ message: "User not found." });
  },
);

// PATCH /authorize-exam-id
router.patch(
  "/authorize-exam-id",
  validateSession,
  async (request, response) => {
    const { title, newId } = request.body;
    try {
      const updatedExam = await updateAuthorizedExamId(title, newId);
      if (!updatedExam)
        return response.status(404).send({ message: "Exam not found." });
      return response
        .status(200)
        .send({ message: "ID updated.", data: updatedExam });
    } catch (error) {
      return response.status(500).send({ message: "Update failed." });
    }
  },
);

export default router;
