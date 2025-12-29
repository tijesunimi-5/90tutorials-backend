// authorize-routes.mjs (FULL & CORRECTED)

import { Router } from "express";
import { resolve } from "path";
// Assuming 'fs' is not strictly needed for the database logic, but kept for completeness
import fs from "fs";
import {
  generateRandomString,
  // Import the function to construct the final ID string for presentation
  constructStudentIdCode,
} from "../../utils/helpers/generateID.mjs";
import { validateSession } from "../../utils/middlewares/validateSession.mjs";
import pool from "../../utils/helpers/db.mjs";
import { updateAuthorizedExamId } from "../../utils/helpers/helper.mjs";

const router = Router();



// ----------------------------------------------------------------------
//                        PG UTILITY FUNCTIONS
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
  // NOTE: CURRENT_TIMESTAMP is used here to get the current year for the display ID.
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
 * Utility to get a single authorized exam and its students, constructing the student ID.
 * @param {string} title - The title of the exam.
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

// GET /authorized (Fetch All Authorized Exams and Students)
router.get("/authorized", validateSession, async (request, response) => {
  try {
    const fileData = await getFileStudentsDataPG();

    if (fileData.length === 0) {
      response.status(404).send({ message: "No Data to display" });
    }

    return response
      .status(200)
      .send({ message: "Fetch successful!", data: fileData });
  } catch (error) {
    console.error("An error occurred:", error);
    return response
      .status(500)
      .send({ message: "An error occurred fetching data" });
  }
});

// POST /authorize-student (Creating the Exam Authorization Record and Sequence)
router.post(
  "/authorize-student",
  validateSession,
  async (request, response) => {
    const { title, id } = request.body;

    if (!title || typeof title !== "string" || !id || typeof id !== "string") {
      return response
        .status(400)
        .send({ message: "Must provide valid title and ID." });
    }

    const examExists = await checkExamExistsPG(title);
    if (!examExists) {
      return response.status(404).send({
        message: `Exam '${title}' not found in the examination catalog.`,
      });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 1. Generate the safe sequence name (e.g., 'UI/PM' -> 'seq_ui_pm')
      const sequenceName = `seq_${id.toLowerCase().replace(/[^a-z0-9_]/g, "")}`;

      // 2. Create the sequence
      await client.query(
        `CREATE SEQUENCE IF NOT EXISTS ${sequenceName} START WITH 1 INCREMENT BY 1`
      );

      // 3. Insert into exams_authorized table
      const insertQuery = `
                INSERT INTO exams_authorized (unique_id, exam_title, id_sequence_name)
                VALUES ($1, $2, $3)
                RETURNING unique_id AS id, exam_title AS exam;
            `;

      const { rows } = await client.query(insertQuery, [
        id,
        title,
        sequenceName,
      ]);
      const newData = rows[0];
      newData.students = [];

      await client.query("COMMIT");

      return response.status(201).send({
        message: "Successfully created exam authorization record and sequence",
        data: newData,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      if (error.code === "23505") {
        return response.status(409).send({
          message:
            "Exam authorization record already exists for this title/ID.",
        });
      }
      console.error("An error occurred during transaction:", error);
      return response.status(500).send({ message: "An error occurred" });
    } finally {
      client.release();
    }
  }
);

// POST /authorize-student/email (Adding Students)
router.post(
  "/authorize-student/email",
  validateSession,
  async (request, response) => {
    const { emails, title } = request.body;

    const emailsToAdd = Array.isArray(emails) ? emails : [emails];

    if (!emailsToAdd || emailsToAdd.length === 0) {
      return response
        .status(400)
        .send({ message: "You must provide student's email(s)" });
    }

    // 1. Find the authorized exam record from the DB
    const authorized = await getAuthorizeExamPG(title);

    if (!authorized) {
      return response
        .status(404)
        .send({ message: "Exam authorization record not found." });
    }

    // Get necessary details for ID generation and transaction
    const examAuthDetails = await pool.query(
      `SELECT id, unique_id, id_sequence_name FROM exams_authorized WHERE id = $1`,
      [authorized.id]
    );
    const { unique_id, id_sequence_name } = examAuthDetails.rows[0];

    // 2. Identify new emails not yet authorized for this exam
    const existingEmails = authorized.students.map((s) =>
      s.email.toLowerCase()
    );
    const emailsToProcess = emailsToAdd.filter(
      (email) => !existingEmails.includes(email.toLowerCase())
    );

    if (emailsToProcess.length === 0) {
      return response.status(200).send({
        message: "All provided users are already authorized.",
        data: authorized,
      });
    }

    // 3. CHECK STUDENT REGISTRATION (THIS DEFINES 'studentResults')
    const studentsCheckPromises = emailsToProcess.map((email) =>
      getRegisteredStudentByEmail(email).then((user) => ({ email, user }))
    );
    const studentResults = await Promise.all(studentsCheckPromises);

    const unregisteredEmails = studentResults
      .filter((result) => !result.user)
      .map((result) => result.email);

    const registeredEmailsToAuthorize = studentResults
      .filter((result) => result.user)
      .map((result) => result.email);

    if (registeredEmailsToAuthorize.length === 0) {
      return response.status(400).send({
        message:
          "None of the provided emails are registered users or new to this exam.",
        unregistered_emails: unregisteredEmails,
      });
    }

    // 4. Use a transaction for safe batch insert
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const insertedStudents = [];

      for (let i = 0; i < registeredEmailsToAuthorize.length; i++) {
        const studentEmail = registeredEmailsToAuthorize[i];

        // Get the next unique number from the sequence atomically
        const nextValResult = await client.query(
          `SELECT nextval($1) AS next_num`,
          [id_sequence_name]
        );
        const sequentialNum = nextValResult.rows[0].next_num;

        const insertStudentQuery = `
                    INSERT INTO students_authorized (sequential_num, email, exam_auth_id)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (exam_auth_id, email) DO NOTHING 
                    RETURNING sequential_num, email;
                `;
        const { rows } = await client.query(insertStudentQuery, [
          sequentialNum,
          studentEmail,
          authorized.id,
        ]);

        if (rows[0]) {
          // Construct the full ID string for the response using the helper
          const fullStudentId = constructStudentIdCode(
            unique_id,
            rows[0].sequential_num
          );

          insertedStudents.push({
            id: fullStudentId,
            email: rows[0].email,
          });
        }
      }

      await client.query("COMMIT");

      const updatedAuthorized = await getAuthorizeExamPG(title);

      const responseData = {
        message: `Successfully added ${insertedStudents.length} registered user(s) to existing exam.`,
        data: updatedAuthorized,
      };

      if (unregisteredEmails.length > 0) {
        responseData.warning = `${unregisteredEmails.length} email(s) were skipped as they are not registered users.`;
        responseData.unregistered_emails_skipped = unregisteredEmails;
      }

      return response.status(200).send(responseData);
    } catch (transactionError) {
      await client.query("ROLLBACK");
      console.error(transactionError);
      return response
        .status(500)
        .send({ message: "Server error during transaction" });
    } finally {
      client.release();
    }
  }
);

// PATCH /authorize-student (Updating Student Email)
router.patch(
  "/authorize-student",
  validateSession,
  async (request, response) => {
    const { title, students: newEmail, id: studentIdCode } = request.body;

    if (!studentIdCode || !title || !newEmail) {
      return response
        .status(400)
        .send({ message: "Missing required fields (id, title, newEmail)." });
    }

    const registeredUser = await getRegisteredStudentByEmail(newEmail);
    if (!registeredUser) {
      return response.status(400).send({
        message: "Cannot update: New email is not a registered user.",
      });
    }

    const examAuthorized = await getAuthorizeExamPG(title);
    if (!examAuthorized) {
      return response
        .status(404)
        .send({ message: "Exam authorization record hasn't been created" });
    }

    // Extract the sequential number (e.g., '0008' -> 8)
    const codeParts = studentIdCode.split("/");
    const sequentialNum = parseInt(codeParts[codeParts.length - 1], 10);

    if (isNaN(sequentialNum)) {
      return response
        .status(400)
        .send({
          message: "Invalid student ID code format or missing sequence number.",
        });
    }

    // Update the student's email using the sequential_num column
    const updateQuery = `
            UPDATE students_authorized
            SET email = $1
            WHERE sequential_num = $2 AND exam_auth_id = $3
            RETURNING *;
        `;
    const { rowCount } = await pool.query(updateQuery, [
      newEmail,
      sequentialNum, // Use the extracted number
      examAuthorized.id,
    ]);

    if (rowCount === 0) {
      return response.status(404).send({
        message: "User doesn't exist for this exam or ID is incorrect",
      });
    }

    return response
      .status(200)
      .send({ message: "Successfully changed the student's email" });
  }
);

// DELETE /authorize-student (Deleting Student)
router.delete(
  "/authorize-student",
  validateSession,
  async (request, response) => {
    const { title, id: studentIdCode } = request.body;

    if (!studentIdCode || typeof studentIdCode !== "string" || !title) {
      return response
        .status(400)
        .send({ message: "Must provide Student's ID and exam title." });
    }

    const examAuthorized = await getAuthorizeExamPG(title);
    if (!examAuthorized) {
      return response
        .status(404)
        .send({ message: "Exam doesn't exist in student authorization" });
    }

    // Extract the sequential number (e.g., '0008' -> 8)
    const codeParts = studentIdCode.split("/");
    const sequentialNum = parseInt(codeParts[codeParts.length - 1], 10);

    if (isNaN(sequentialNum)) {
      return response
        .status(400)
        .send({
          message: "Invalid student ID code format or missing sequence number.",
        });
    }

    // Delete the student record using the sequential_num
    const deleteQuery = `
            DELETE FROM students_authorized
            WHERE sequential_num = $1 AND exam_auth_id = $2;
        `;
    const { rowCount } = await pool.query(deleteQuery, [
      sequentialNum, // Use the extracted number
      examAuthorized.id,
    ]);

    if (rowCount === 0) {
      return response.status(404).send({
        message: "Student doesn't exist for this exam or ID is incorrect",
      });
    }

    return response
      .status(200)
      .send({ message: "Successfully deleted Student's data" });
  }
);



router.patch(
  "/authorize-exam-id", // New dedicated endpoint
  validateSession,
  async (request, response) => {
    const { title, newId } = request.body;

    try {
      if (
        !title ||
        !newId ||
        typeof title !== "string" ||
        typeof newId !== "string"
      ) {
        return response
          .status(400)
          .send({
            message: "Must provide a valid exam title and new unique ID.",
          });
      }

      // Call the database function to update the ID
      const updatedExam = await updateAuthorizedExamId(title, newId);

      if (!updatedExam) {
        return response
          .status(404)
          .send({
            message: `Exam authorization record not found for title: ${title}`,
          });
      }

      return response.status(200).send({
        message: `Exam ID prefix successfully updated from ${updatedExam.unique_id} to ${newId}.`,
        data: updatedExam,
      });
    } catch (error) {
      console.error("Error updating authorized exam ID:", error);
      if (error.code === "23505") {
        return response.status(409).send({
          message: `The new ID prefix '${newId}' is already in use by another authorized exam.`,
        });
      }
      return response
        .status(500)
        .send({ message: "Server error during ID update." });
    }
  }
);

export default router;
