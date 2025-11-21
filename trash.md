// authorize-routes.mjs
import { Router } from "express";
import { resolve } from "path";
import fs from "fs";
import {
  generateRandomString,
  generateSequentialString,
} from "../../utils/helpers/generateID.mjs";
import { validateSession } from "../../utils/middlewares/validateSession.mjs";
import pool from "../../utils/helpers/db.mjs";

const router = Router();

// --- Configuration and External Data ---
const examFile = resolve("exam.json");
const examData = JSON.parse(fs.readFileSync(examFile, "utf-8"));

const getExamByTitle = (name) => {
  const parsedTitle = name.toLowerCase();
  const found = examData.find(
    (exam) => exam.title.toLowerCase() === parsedTitle
  );
  return found ? found.title : null;
};

// --- NEW/UPDATED PG Utility Functions ---

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

async function checkExamExistsPG(title) {
  const query = `SELECT 1 FROM examinations WHERE title = $1`;
  const result = await pool.query(query, [title]);
  return result.rows.length > 0;
}

/**
 * Corrected signature: no 'pool' argument, uses global import.
 */
async function getFileStudentsDataPG() {
  const query = `
    SELECT
      ea.unique_id AS id,
      ea.exam_title AS exam,
      COALESCE(
        json_agg(
          json_build_object(
            'id', sa.student_id_code,
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
  `; // Uses imported 'pool'
  const { rows } = await pool.query(query);
  return rows;
}

/**
 * Corrected signature: only 'title' argument, uses global import.
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
                    'id', sa.student_id_code,
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
  `; // Uses imported 'pool'
  const { rows } = await pool.query(query, [parsedTitle]);
  return rows[0]; // Returns the exam object or undefined
}

// --- Routes ---

router.get("/authorized", validateSession, async (request, response) => {
  try {
    // Corrected call: No 'pool' argument
    const fileData = await getFileStudentsDataPG();

    if (fileData.length === 0) {
      return response.status(404).send({ message: "No Data to display" });
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

router.post(
  "/authorize-student",
  validateSession,
  async (request, response) => {
    const { title, id } = request.body;

    try {
      if (!title || typeof title !== "string") {
        return response
          .status(400)
          .send({ message: "Title must contain characters" });
      } // Check if the exam exists in the main examinations table (DB)

      const examExists = await checkExamExistsPG(title);
      if (!examExists) {
        return response.status(404).send({
          message: `Exam '${title}' not found in the examination catalog.`,
        });
      }

      if (!id || typeof id !== "string") {
        return response
          .status(400)
          .send({ message: "Must provide identify for id" });
      } // Insert into exams_authorized table

      const insertQuery = `
        INSERT INTO exams_authorized (unique_id, exam_title)
        VALUES ($1, $2)
        RETURNING unique_id AS id, exam_title AS exam;
      `;

      const { rows } = await pool.query(insertQuery, [id, title]);
      const newData = rows[0];

      newData.students = [];

      return response.status(201).send({
        message: "Successfully created exam authorization record",
        data: newData,
      });
    } catch (error) {
      if (error.code === "23505") {
        return response.status(409).send({
          message: "Exam authorization record already exists for this title/ID",
        });
      }
      console.error("An error occured:", error);
      return response.status(500).send({ message: "An error occured" });
    }
  }
);

router.post(
  "/authorize-student/email",
  validateSession,
  async (request, response) => {
    const { emails, title } = request.body;

    try {
      const emailsToAdd = Array.isArray(emails) ? emails : [emails];

      if (!emailsToAdd || emailsToAdd.length === 0) {
        return response
          .status(400)
          .send({ message: "You must provide student's email(s)" });
      } // 1. Find the authorized exam record from the DB // Corrected call: No 'pool' argument

      const authorized = await getAuthorizeExamPG(title);

      if (!authorized) {
        return response
          .status(404)
          .send({ message: "Exam authorization record not found." });
      } // 2. Identify new emails not yet authorized for this exam

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
      } // 3. CHECK STUDENT REGISTRATION (EXISTENCE IN USERS TABLE)

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
      } // 4. Use a transaction for safe batch insert

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const insertedStudents = [];

        for (let i = 0; i < registeredEmailsToAuthorize.length; i++) {
          const studentEmail = registeredEmailsToAuthorize[i]; // Correct usage: generateSequentialString requires the client/pool as the first argument

          const newStudentIdCode = await generateSequentialString(
            client,
            authorized.unique_id,
            title,
            4,
            i
          );

          const insertStudentQuery = `
              INSERT INTO students_authorized (student_id_code, email, exam_auth_id)
              VALUES ($1, $2, $3)
              ON CONFLICT (exam_auth_id, email) DO NOTHING 
              RETURNING student_id_code AS id, email;
            `;
          const { rows } = await client.query(insertStudentQuery, [
            newStudentIdCode,
            studentEmail,
            authorized.id,
          ]);

          if (rows[0]) {
            insertedStudents.push(rows[0]);
          }
        }

        await client.query("COMMIT"); // Corrected call: No 'pool' argument

        const updatedAuthorized = await getAuthorizeExamPG(title);

        const responseData = {
          message: `Successfully added ${insertedStudents.length} registered user(s) to existing exam.`,
          data: updatedAuthorized,
        }; // If some emails were unregistered, include a warning

        if (unregisteredEmails.length > 0) {
          responseData.warning = `${unregisteredEmails.length} email(s) were skipped as they are not registered users.`;
          responseData.unregistered_emails_skipped = unregisteredEmails;
        }

        return response.status(200).send(responseData);
      } catch (transactionError) {
        await client.query("ROLLBACK");
        throw transactionError;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error(error);
      return response.status(500).send({ message: "Server error" });
    }
  }
);

router.patch(
  "/authorize-student",
  validateSession,
  async (request, response) => {
    const { title, students: newEmail, id: studentIdCode } = request.body;
    try {
      if (!studentIdCode) {
        return response
          .status(400)
          .send({ message: "Id must not be left empty" });
      }

      if (!title || typeof title !== "string") {
        return response
          .status(400)
          .send({ message: "Title must contain characters" });
      } // Check if the new email is a registered user

      const registeredUser = await getRegisteredStudentByEmail(newEmail);
      if (!registeredUser) {
        return response.status(400).send({
          message: "Cannot update: New email is not a registered user.",
        });
      } // Corrected call: No 'pool' argument

      const examAuthorized = await getAuthorizeExamPG(title);
      if (!examAuthorized) {
        return response
          .status(404)
          .send({ message: "Exam authorization record hasn't been created" });
      }

      if (!newEmail) {
        return response
          .status(400)
          .send({ message: "Student's field cannot be left empty" });
      } // Update the student's email

      const updateQuery = `
      UPDATE students_authorized
      SET email = $1
      WHERE student_id_code = $2 AND exam_auth_id = $3
      RETURNING *;
    `;
      const { rowCount } = await pool.query(updateQuery, [
        newEmail,
        studentIdCode,
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
    } catch (error) {
      console.error("An error occured:", error);
      if (error.code === "23505") {
        return response.status(409).send({
          message: "The new email is already authorized for this exam.",
        });
      }
      return response.status(500).send({ message: "Something went wrong" });
    }
  }
);

router.delete(
  "/authorize-student",
  validateSession,
  async (request, response) => {
    const { title, id: studentIdCode } = request.body;
    try {
      if (!studentIdCode || typeof studentIdCode !== "string") {
        return response
          .status(400)
          .send({ message: "Must provide Student's ID" });
      }

      if (!title) {
        return response
          .status(400)
          .send({ message: "Must provide exam title" });
      } // Corrected call: No 'pool' argument

      const examAuthorized = await getAuthorizeExamPG(title);
      if (!examAuthorized) {
        return response
          .status(404)
          .send({ message: "Exam doesn't exist in student authorization" });
      } // Delete the student record

      const deleteQuery = `
      DELETE FROM students_authorized
      WHERE student_id_code = $1 AND exam_auth_id = $2;
    `;
      const { rowCount } = await pool.query(deleteQuery, [
        studentIdCode,
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
    } catch (error) {
      console.log(error);
      return response
        .status(500)
        .send({ message: "An error occured", error: error.message });
    }
  }
);

export default router;
