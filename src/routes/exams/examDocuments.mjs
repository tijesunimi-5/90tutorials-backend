import { Router } from "express";
// Assuming pool, validateSession, and errorHandler are correctly implemented
import pool from "../../utils/helpers/db.mjs";
import { validateSession } from "../../utils/middlewares/validateSession.mjs";
import { errorHandler } from "../../utils/helpers/errorHandler.mjs";

const router = Router();

/**
 * Utility function to find an exam by its ID (integer) or Title (string).
 * @param {string|number} identifier - Exam ID or title.
 * @returns {Promise<object|null>} The examination object or null if not found.
 */
const getExamByIdentifier = async (identifier) => {
  const queryByTitle = `SELECT * FROM examinations WHERE title = $1`;
  const queryById = `SELECT * FROM examinations WHERE exam_id = $1`;

  if (!identifier) {
    return null;
  }

  try {
    let result;
    if (/^\d+$/.test(String(identifier))) {
      // It looks like an integer ID
      result = await pool.query(queryById, [parseInt(identifier, 10)]);
    } else {
      // Treat it as a title string
      result = await pool.query(queryByTitle, [identifier]);
    }

    return result.rows[0] || null;
  } catch (error) {
    console.error("Error fetching exam by identifier:", error);
    // Re-throw to be caught by the calling route handler's try/catch
    throw error;
  }
};

// ------------------------------- EXAM CATEGORY ROUTES ---------------------------

router.post("/category", validateSession, async (request, response) => {
  const { categories } = request.body;
  const insertQuery = `INSERT INTO exam_categories (name) VALUES ($1) RETURNING category_id, name`;

  if (
    !categories ||
    typeof categories !== "string" ||
    categories.trim() === ""
  ) {
    return response
      .status(400)
      .send({ message: "A valid category name is required." });
  }

  try {
    // Note: The UNIQUE constraint on 'name' in the DB schema handles the 'Category exists' check,
    // which is more reliable than a separate SELECT query.
    const result = await pool.query(insertQuery, [categories.trim()]);

    return response
      .status(201)
      .send({ message: "Category added successfully.", data: result.rows[0] });
  } catch (error) {
    // Handle PostgreSQL specific errors (e.g., 23505 for unique violation)
    const message = errorHandler(error);
    const statusCode = error.code === "23505" ? 409 : 500; // 409 Conflict for duplicate
    return response.status(statusCode).send({
      message:
        statusCode === 409
          ? "Category already exists."
          : "Failed to add category.",
      error: message,
      technical_code: error.code,
    });
  }
});

router.get("/categories", validateSession, async (request, response) => {
  try {
    const result = await pool.query(
      "SELECT * FROM exam_categories ORDER BY name ASC"
    );

    if (result.rows.length === 0) {
      return response.status(404).send({ message: "No categories found." });
    }

    return response
      .status(200)
      .send({ message: "Categories fetched successfully.", data: result.rows });
  } catch (error) {
    const message = errorHandler(error);
    return response.status(500).send({
      message: "Network error, please try again.",
      error: message,
      technical_code: error.code,
    });
  }
});

router.delete("/category/:id", validateSession, async (request, response) => {
  const { id } = request.params;

  if (isNaN(parseInt(id, 10))) {
    return response
      .status(400)
      .send({ message: "Invalid category ID provided." });
  }

  const deleteQuery = `DELETE FROM exam_categories WHERE category_id = $1 RETURNING category_id`;

  try {
    const result = await pool.query(deleteQuery, [id]);

    if (result.rows.length === 0) {
      return response.status(404).send({ message: "Category not found." });
    }
    // Due to the 'ON DELETE CASCADE' rule in the schema, all linked examinations will also be deleted.

    return response.status(200).send({
      message: `Category (ID: ${id}) and all associated exams have been removed.`,
    });
  } catch (error) {
    const message = errorHandler(error);
    return response.status(500).send({
      message: "Failed to delete category.",
      error: message,
      technical_code: error.code,
    });
  }
});

// ------------------------------- EXAM ROUTES ---------------------------

// --- Backend Route Handler for GET /all-exams (Replaced for Robustness) ---

router.get("/all-exams", validateSession, async (request, response) => {
  // 1. SQL Query: Fetch all related data in a single, efficient (but flat) structure.
  const fetchQuery = `
        SELECT
            e.exam_id,
            e.title,
            e.duration_minutes,
            e.created_at,
            c.name AS category_name,
            
            s.subject_id,
            s.name AS subject_name,
            
            q.question_id,
            q.question_text,
            
            o.option_id,
            o.option_text,
            o.is_correct
        FROM examinations e
        JOIN exam_categories c ON e.category_id = c.category_id
        LEFT JOIN subjects s ON e.exam_id = s.exam_id
        LEFT JOIN questions q ON s.subject_id = q.subject_id
        LEFT JOIN options o ON q.question_id = o.question_id
        ORDER BY e.exam_id, s.subject_id, q.question_id, o.option_id;
    `;

  const client = await pool.connect();
  try {
    const result = await client.query(fetchQuery);

    if (result.rows.length === 0) {
      return response.status(404).send({ message: "No examinations found." });
    }

    // 2. Data Aggregation: Convert flat SQL results into nested JSON (Exam -> Subject -> Q -> O).
    const examsMap = new Map();

    for (const row of result.rows) {
      if (!examsMap.has(row.exam_id)) {
        examsMap.set(row.exam_id, {
          exam_id: row.exam_id,
          title: row.title,
          duration: row.duration_minutes,
          category_name: row.category_name,
          created_at: row.created_at,
          subjects: new Map(),
        });
      }

      const exam = examsMap.get(row.exam_id);

      // Subject Aggregation
      if (row.subject_id && !exam.subjects.has(row.subject_id)) {
        exam.subjects.set(row.subject_id, {
          subject_id: row.subject_id,
          name: row.subject_name,
          questions: new Map(),
        });
      }
      const subject = exam.subjects.get(row.subject_id);

      // Question Aggregation
      if (row.question_id && !subject.questions.has(row.question_id)) {
        subject.questions.set(row.question_id, {
          id: row.question_id,
          question: row.question_text,
          answer: "", // Will be set by the correct option later
          options: [],
        });
      }
      const question = subject?.questions.get(row.question_id);

      // Option Aggregation
      if (row.option_id && question) {
        const option = {
          id: row.option_id,
          text: row.option_text,
        };
        question.options.push(option);

        // Set Correct Answer
        if (row.is_correct) {
          question.answer = row.option_text;
        }
      }
    }

    // 3. Final Formatting: Convert Maps back to arrays (ExamDoc[] format).
    const aggregatedExams = Array.from(examsMap.values()).map((exam) => ({
      ...exam,
      subjects: Array.from(exam.subjects.values()).map((subject) => ({
        ...subject,
        questions: Array.from(subject.questions.values()),
      })),
    }));

    return response.status(200).send({
      message: "Detailed examinations fetched.",
      data: aggregatedExams,
    });
  } catch (error) {
    const message = errorHandler(error);
    return response.status(500).send({
      message: "An error occurred while fetching detailed exams.",
      error: message,
      technical_code: error.code,
    });
  } finally {
    client.release();
  }
});

// In your backend router file (e.g., users.mjs or exam router)

router.get("/exam/id/:title", async (request, response) => {
    const { title } = request.params;
    
    // Decode title in case it had spaces (e.g., "UniIbadan%20Postutme")
    const decodedTitle = decodeURIComponent(title);

    try {
        // Find the exam_id using the title in the examinations table
        const query = "SELECT exam_id FROM examinations WHERE title = $1";
        const result = await pool.query(query, [decodedTitle]);

        if (result.rows.length === 0) {
            return response.status(404).send({ message: "Exam not found" });
        }

        // Return the exam ID
        return response.status(200).send({
            message: "Successfully fetched exam ID", 
            exam_id: result.rows[0].exam_id 
        });
    } catch (error) {
        console.error("Error fetching exam ID by title:", error);
        return response.status(500).send({ message: "Server error." });
    }
});

// Example new backend route for fetching exam details and subjects
router.get("/exam/details/:title", async (request, response) => {
    const { title } = request.params;
    const decodedTitle = decodeURIComponent(title);

    try {
        // Query to fetch the main exam details
        const examQuery = `
            SELECT exam_id, title, duration_minutes 
            FROM examinations 
            WHERE title = $1
        `;
        const examResult = await pool.query(examQuery, [decodedTitle]);
        const exam = examResult.rows[0];

        if (!exam) {
            return response.status(404).send({ message: "Exam not found" });
        }

        // Query to fetch all subjects and aggregate their question counts
        const subjectsQuery = `
            SELECT 
                s.subject_id, 
                s.name, 
                COALESCE(
                    json_agg(
                        json_build_object('question_id', q.question_id)
                    ) FILTER (WHERE q.question_id IS NOT NULL), 
                    '[]'::json
                ) AS questions 
            FROM subjects s
            LEFT JOIN questions q ON s.subject_id = q.subject_id
            WHERE s.exam_id = $1
            GROUP BY s.subject_id, s.name
            ORDER BY s.name
        `;
        const subjectsResult = await pool.query(subjectsQuery, [exam.exam_id]);

        // Note: The subjectsResult.rows structure should align with your Subject type definition
        // (e.g., if Subject.questions is an array of questions objects).
        
        return response.status(200).send({
            message: "Successfully fetched exam and subjects", 
            data: {
                ...exam,
                subjects: subjectsResult.rows,
            }
        });
    } catch (error) {
        console.error("Error fetching exam details:", error);
        return response.status(500).send({ message: "Server error." });
    }
});

router.get(
  "/exam/questions/:examId",
  validateSession,
  async (request, response) => {
    const { examId } = request.params;
    const numericExamId = parseInt(examId, 10);

    if (isNaN(numericExamId)) {
      return response.status(400).send({ message: "Invalid exam ID." });
    }

    const fetchQuery = `
        SELECT
            e.exam_id,
            e.title,
            e.duration_minutes,
            s.subject_id,
            s.name AS subject_name,
            q.question_id,
            q.question_text,
            o.option_id,
            o.option_text,
            o.is_correct
        FROM examinations e
        LEFT JOIN subjects s ON e.exam_id = s.exam_id
        LEFT JOIN questions q ON s.subject_id = q.subject_id
        LEFT JOIN options o ON q.question_id = o.question_id
        WHERE e.exam_id = $1
        ORDER BY s.subject_id, q.question_id, o.option_id;
    `;

    const client = await pool.connect();
    try {
      const result = await client.query(fetchQuery, [numericExamId]);

      if (result.rows.length === 0) {
        // Check if the exam itself exists before returning 404
        const examExists = await client.query(
          "SELECT exam_id FROM examinations WHERE exam_id = $1",
          [numericExamId]
        );
        if (examExists.rows.length === 0) {
          return response.status(404).send({ message: "Exam not found." });
        }
        // Exam found, but no subjects/questions associated. Return empty data.
        return response.status(200).send({
          message: "Exam fetched, but no subjects found.",
          data: {
            exam_id: numericExamId,
            title: examExists.rows[0].title, // Fetch basic info if deep fetch failed
            duration_minutes: examExists.rows[0].duration_minutes,
            subjects: [], // Ensure 'subjects' array is present, even if empty
          },
        });
      }

      // --- Data Aggregation ---
      const firstRow = result.rows[0];
      const examDetails = {
        exam_id: firstRow.exam_id,
        title: firstRow.title,
        duration_minutes: firstRow.duration_minutes,
        subjects: new Map(),
      };

      for (const row of result.rows) {
        if (row.subject_id) {
          if (!examDetails.subjects.has(row.subject_id)) {
            examDetails.subjects.set(row.subject_id, {
              subject_id: row.subject_id,
              name: row.subject_name,
              questions: new Map(),
            });
          }
          const subject = examDetails.subjects.get(row.subject_id);

          if (row.question_id && !subject.questions.has(row.question_id)) {
            subject.questions.set(row.question_id, {
              id: row.question_id, // Primary key identifier
              question_id: row.question_id, // Duplicated for compatibility with your Questions type
              question_text: row.question_text,
              options: [],
              answer: "", // Placeholder for the correct answer text
            });
          }
          const question = subject.questions.get(row.question_id);

          if (row.option_id && question) {
            const option = {
              id: row.option_id,
              text: row.option_text,
            };
            question.options.push(option);

            if (row.is_correct) {
              question.answer = row.option_text;
            }
          }
        }
      }

      // Final Formatting: Convert Maps back to arrays
      const finalSubjects = Array.from(examDetails.subjects.values()).map(
        (subject) => ({
          ...subject,
          questions: Array.from(subject.questions.values()),
        })
      );

      return response.status(200).send({
        message: "Detailed exam questions fetched.",
        data: {
          ...examDetails,
          subjects: finalSubjects,
        },
      });
    } catch (error) {
      console.error("Error fetching detailed exam questions:", error);
      const message = errorHandler(error);
      return response.status(500).send({
        message: "An error occurred while fetching exam data.",
        error: message,
        technical_code: error.code,
      });
    } finally {
      client.release();
    }
  }
);

router.get("/exams/:identifier", validateSession, async (request, response) => {
  const { identifier } = request.params;

  try {
    if (!identifier) {
      return response
        .status(400)
        .json({ message: "Exam ID or title is required." });
    }

    const exam = await getExamByIdentifier(identifier);

    if (!exam) {
      return response
        .status(404)
        .send({ message: "No exam found matching the identifier." });
    }

    return response.status(200).send({ message: "Exam fetched.", data: exam });
  } catch (error) {
    const message = errorHandler(error);
    return response.status(500).send({
      message: "An error occurred while filtering exams.",
      error: message,
      technical_code: error.code,
    });
  }
});

router.post("/exam", validateSession, async (request, response) => {
  const { title, duration, category_id } = request.body;
  const insertExamQuery = `INSERT INTO examinations (title, duration_minutes, category_id) VALUES ($1, $2, $3) RETURNING *`;

  if (!title || !duration || !category_id) {
    return response.status(400).send({
      message: "Title, duration, and category_id are required fields.",
    });
  }

  if (typeof duration !== "number" || duration <= 0) {
    return response
      .status(400)
      .send({ message: "Duration must be a positive number." });
  }

  try {
    const result = await pool.query(insertExamQuery, [
      title,
      duration,
      category_id,
    ]);

    return response.status(201).send({
      message: "Exam has successfully been added.",
      data: result.rows[0],
    });
  } catch (error) {
    const message = errorHandler(error);
    const statusCode = error.code === "23505" ? 409 : 500; // Unique constraint violation (title)
    const clientMessage =
      statusCode === 409
        ? "An exam with this title already exists."
        : "Failed to create exam.";

    return response.status(statusCode).send({
      message: clientMessage,
      error: message,
      technical_code: error.code,
    });
  }
});

router.patch("/exam/:id/edit", validateSession, async (request, response) => {
  const { id } = request.params;
  const updates = request.body;

  if (isNaN(parseInt(id, 10))) {
    return response.status(400).send({ message: "Invalid exam ID provided." });
  }

  // Dynamically build the UPDATE query
  const fields = [];
  const values = [];
  let paramIndex = 1;

  if (updates.title) {
    fields.push(`title = $${paramIndex++}`);
    values.push(updates.title);
  }
  if (updates.duration !== undefined) {
    if (typeof updates.duration !== "number" || updates.duration <= 0) {
      return response
        .status(400)
        .send({ message: "Duration must be a positive number." });
    }
    fields.push(`duration_minutes = $${paramIndex++}`);
    values.push(updates.duration);
  }
  if (updates.category_id !== undefined) {
    fields.push(`category_id = $${paramIndex++}`);
    values.push(updates.category_id);
  }

  if (fields.length === 0) {
    return response
      .status(400)
      .send({ message: "No valid fields provided for update." });
  }

  values.push(id); // The ID is the last parameter

  const updateQuery = `UPDATE examinations SET ${fields.join(
    ", "
  )} WHERE exam_id = $${paramIndex} RETURNING *`;

  try {
    const result = await pool.query(updateQuery, values);

    if (result.rows.length === 0) {
      return response
        .status(404)
        .send({ message: "Exam not found or no changes made." });
    }

    return response
      .status(200)
      .send({ message: "Exam successfully updated.", data: result.rows[0] });
  } catch (error) {
    const message = errorHandler(error);
    const statusCode = error.code === "23505" ? 409 : 500; // Unique constraint violation (title)

    return response.status(statusCode).send({
      message: "Failed to update exam.",
      error: message,
      technical_code: error.code,
    });
  }
});

router.delete("/exam/:id", validateSession, async (request, response) => {
  const { id } = request.params;

  if (isNaN(parseInt(id, 10))) {
    return response.status(400).send({ message: "Invalid exam ID provided." });
  }

  const deleteQuery = `DELETE FROM examinations WHERE exam_id = $1 RETURNING exam_id`;

  try {
    const result = await pool.query(deleteQuery, [id]);

    if (result.rows.length === 0) {
      return response.status(404).send({ message: "Exam not found." });
    }
    // ON DELETE CASCADE handles subjects, questions, and options cleanup

    return response
      .status(200)
      .send({ message: `Exam (ID: ${id}) successfully removed.` });
  } catch (error) {
    const message = errorHandler(error);
    return response.status(500).send({
      message: "Failed to delete exam.",
      error: message,
      technical_code: error.code,
    });
  }
});

// ------------------------------- SUBJECT ROUTES ---------------------------

router.post(
  "/exam/:examId/subjects",
  validateSession,
  async (request, response) => {
    const { examId } = request.params;
    const { subjectName } = request.body; // Expect subjectName to be an array of strings

    if (isNaN(parseInt(examId, 10))) {
      return response.status(400).send({ message: "Invalid exam ID." });
    }

    if (!Array.isArray(subjectName) || subjectName.length === 0) {
      return response
        .status(400)
        .send({ message: "A list of subjects is required." });
    }

    const client = await pool.connect();
    const successfulSubjects = [];

    try {
      await client.query("BEGIN");

      const insertQuery = `INSERT INTO subjects (exam_id, name) VALUES ($1, $2) ON CONFLICT (exam_id, name) DO NOTHING RETURNING *`;

      for (const name of subjectName) {
        if (typeof name === "string" && name.trim() !== "") {
          const result = await client.query(insertQuery, [examId, name.trim()]);
          if (result.rows.length > 0) {
            successfulSubjects.push(result.rows[0]);
          }
        }
      }

      await client.query("COMMIT");

      if (successfulSubjects.length === 0) {
        return response.status(400).send({
          message: "No new subjects were added (they may already exist).",
        });
      }

      return response.status(201).send({
        message:
          "Subjects added successfully. Existing duplicates were ignored.",
        data: successfulSubjects,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      const message = errorHandler(error);
      return response.status(500).send({
        message: "Failed to add subjects.",
        error: message,
        technical_code: error.code,
      });
    } finally {
      client.release();
    }
  }
);

router.patch(
  "/exam/:examId/subjects/:subjectId",
  validateSession,
  async (request, response) => {
    const { examId, subjectId } = request.params;
    const { newSubjectName } = request.body;

    if (isNaN(parseInt(examId, 10)) || isNaN(parseInt(subjectId, 10))) {
      return response
        .status(400)
        .send({ message: "Invalid Exam or Subject ID." });
    }

    if (
      !newSubjectName ||
      typeof newSubjectName !== "string" ||
      newSubjectName.trim() === ""
    ) {
      return response
        .status(400)
        .send({ message: "A valid new subject name must be provided." });
    }

    const updateQuery = `UPDATE subjects SET name = $1 WHERE subject_id = $2 AND exam_id = $3 RETURNING *`;

    try {
      const result = await pool.query(updateQuery, [
        newSubjectName.trim(),
        subjectId,
        examId,
      ]);

      if (result.rows.length === 0) {
        return response
          .status(404)
          .send({ message: "Subject not found in the specified exam." });
      }

      return response.status(200).send({
        message: "Subject name successfully updated.",
        data: result.rows[0],
      });
    } catch (error) {
      const message = errorHandler(error);
      const statusCode = error.code === "23505" ? 409 : 500; // Unique constraint violation (exam_id, name)

      return response.status(statusCode).send({
        message:
          statusCode === 409
            ? "A subject with this name already exists in this exam."
            : "Failed to update subject.",
        error: message,
        technical_code: error.code,
      });
    }
  }
);

router.delete(
  "/exam/:examId/subjects/:subjectId",
  validateSession,
  async (request, response) => {
    const { examId, subjectId } = request.params;

    if (isNaN(parseInt(examId, 10)) || isNaN(parseInt(subjectId, 10))) {
      return response
        .status(400)
        .send({ message: "Invalid Exam or Subject ID." });
    }

    const deleteQuery = `DELETE FROM subjects WHERE subject_id = $1 AND exam_id = $2 RETURNING subject_id`;

    try {
      const result = await pool.query(deleteQuery, [subjectId, examId]);

      if (result.rows.length === 0) {
        return response
          .status(404)
          .send({ message: "Subject not found in the specified exam." });
      }
      // ON DELETE CASCADE handles question and options cleanup

      return response
        .status(200)
        .send({ message: `Subject (ID: ${subjectId}) successfully removed.` });
    } catch (error) {
      const message = errorHandler(error);
      return response.status(500).send({
        message: "Failed to delete subject.",
        error: message,
        technical_code: error.code,
      });
    }
  }
);

// ------------------------------- QUESTION & OPTION ROUTES ---------------------------

router.post(
  "/exam/:examId/subjects/:subjectId/questions",
  validateSession,
  async (request, response) => {
    const { subjectId } = request.params;
    const { question, options, answer } = request.body; // options is expected to be an array of option strings, answer is the correct option string

    if (isNaN(parseInt(subjectId, 10))) {
      return response.status(400).send({ message: "Invalid Subject ID." });
    }

    if (!question || !Array.isArray(options) || options.length < 2 || !answer) {
      return response.status(400).send({
        message: "Missing required fields (question, options[], answer).",
      });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 1. Insert Question
      const insertQuestionQuery = `INSERT INTO questions (subject_id, question_text) VALUES ($1, $2) RETURNING question_id`;
      const qResult = await client.query(insertQuestionQuery, [
        subjectId,
        question,
      ]);
      const questionId = qResult.rows[0].question_id;

      // 2. Insert Options
      const insertOptionQuery = `INSERT INTO options (question_id, option_text, is_correct) VALUES ($1, $2, $3)`;

      for (const optText of options) {
        if (typeof optText === "string" && optText.trim() !== "") {
          // Check if this option matches the correct answer string
          const isCorrect = optText.trim() === answer.trim();
          await client.query(insertOptionQuery, [
            questionId,
            optText.trim(),
            isCorrect,
          ]);
        }
      }

      await client.query("COMMIT");

      return response.status(201).send({
        message: "Question and options saved successfully.",
        data: { question_id: questionId, question, options, answer },
      });
    } catch (error) {
      await client.query("ROLLBACK");
      const message = errorHandler(error);
      return response.status(500).send({
        message: "Failed to add question. Transaction rolled back.",
        error: message,
        technical_code: error.code,
      });
    } finally {
      client.release();
    }
  }
);

router.patch(
  "/exam/:examId/subjects/:subjectId/questions/:questionId",
  validateSession,
  async (request, response) => {
    const { questionId } = request.params;
    const { question_text } = request.body; // Only allowing question_text change here

    if (isNaN(parseInt(questionId, 10))) {
      return response.status(400).send({ message: "Invalid Question ID." });
    }

    if (
      !question_text ||
      typeof question_text !== "string" ||
      question_text.trim() === ""
    ) {
      return response
        .status(400)
        .send({ message: "New question text is required." });
    }

    const updateQuery = `UPDATE questions SET question_text = $1 WHERE question_id = $2 RETURNING *`;

    try {
      const result = await pool.query(updateQuery, [
        question_text.trim(),
        questionId,
      ]);

      if (result.rows.length === 0) {
        return response.status(404).send({ message: "Question not found." });
      }

      return response.status(200).send({
        message: "Question text successfully updated.",
        data: result.rows[0],
      });
    } catch (error) {
      const message = errorHandler(error);
      return response.status(500).send({
        message: "Failed to update question.",
        error: message,
        technical_code: error.code,
      });
    }
  }
);

router.patch(
  "/exam/:examId/subjects/:subjectId/questions/:questionId/options/:optionId",
  validateSession,
  async (request, response) => {
    const { questionId, optionId } = request.params;
    const { option_text, is_correct } = request.body; // Can update text or correct status

    if (isNaN(parseInt(questionId, 10)) || isNaN(parseInt(optionId, 10))) {
      return response
        .status(400)
        .send({ message: "Invalid Question or Option ID." });
    }

    const fields = [];
    const values = [];
    let paramIndex = 1;

    if (option_text !== undefined) {
      if (typeof option_text !== "string" || option_text.trim() === "") {
        return response
          .status(400)
          .send({ message: "Option text must be a non-empty string." });
      }
      fields.push(`option_text = $${paramIndex++}`);
      values.push(option_text.trim());
    }

    if (is_correct !== undefined) {
      if (typeof is_correct !== "boolean") {
        return response
          .status(400)
          .send({ message: "is_correct must be a boolean." });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        if (is_correct === true) {
          // 1. If we set this option to correct, first set all others in the same question to false
          const resetQuery = `UPDATE options SET is_correct = FALSE WHERE question_id = $1`;
          await client.query(resetQuery, [questionId]);
        }
        // 2. Then, set the target option's is_correct status (whether true or false)
        fields.push(`is_correct = $${paramIndex++}`);
        values.push(is_correct);

        values.push(optionId, questionId); // for WHERE clause

        const updateQuery = `UPDATE options SET ${fields.join(
          ", "
        )} WHERE option_id = $${paramIndex++} AND question_id = $${paramIndex} RETURNING *`;
        const result = await client.query(updateQuery, values);

        await client.query("COMMIT");

        if (result.rows.length === 0) {
          return response
            .status(404)
            .send({ message: "Option not found in the specified question." });
        }

        return response.status(200).send({
          message: "Option successfully updated.",
          data: result.rows[0],
        });
      } catch (error) {
        await client.query("ROLLBACK");
        const message = errorHandler(error);
        return response.status(500).send({
          message: "Failed to update option. Transaction rolled back.",
          error: message,
          technical_code: error.code,
        });
      } finally {
        client.release();
      }
    } else if (fields.length > 0) {
      // Handle text update without changing is_correct
      values.push(optionId, questionId); // for WHERE clause

      const updateQuery = `UPDATE options SET ${fields.join(
        ", "
      )} WHERE option_id = $${paramIndex++} AND question_id = $${paramIndex} RETURNING *`;
      const result = await pool.query(updateQuery, values);

      if (result.rows.length === 0) {
        return response
          .status(404)
          .send({ message: "Option not found in the specified question." });
      }

      return response.status(200).send({
        message: "Option text successfully updated.",
        data: result.rows[0],
      });
    } else {
      return response
        .status(400)
        .send({ message: "No valid fields provided for update." });
    }
  }
);

router.delete(
  "/exam/:examId/subjects/:subjectId/questions/:questionId",
  validateSession,
  async (request, response) => {
    const { questionId } = request.params;

    if (isNaN(parseInt(questionId, 10))) {
      return response.status(400).send({ message: "Invalid Question ID." });
    }

    const deleteQuery = `DELETE FROM questions WHERE question_id = $1 RETURNING question_id`;

    try {
      const result = await pool.query(deleteQuery, [questionId]);

      if (result.rows.length === 0) {
        return response.status(404).send({ message: "Question not found." });
      }
      // ON DELETE CASCADE handles options cleanup

      return response.status(200).send({
        message: `Question (ID: ${questionId}) successfully removed.`,
      });
    } catch (error) {
      const message = errorHandler(error);
      return response.status(500).send({
        message: "Failed to delete question.",
        error: message,
        technical_code: error.code,
      });
    }
  }
);

router.delete(
  "/exam/:examId/subjects/:subjectId/questions/:questionId/options/:optionId",
  validateSession,
  async (request, response) => {
    const { questionId, optionId } = request.params;

    if (isNaN(parseInt(questionId, 10)) || isNaN(parseInt(optionId, 10))) {
      return response
        .status(400)
        .send({ message: "Invalid Question or Option ID." });
    }

    const deleteQuery = `DELETE FROM options WHERE option_id = $1 AND question_id = $2 RETURNING option_id`;

    try {
      const result = await pool.query(deleteQuery, [optionId, questionId]);

      if (result.rows.length === 0) {
        return response
          .status(404)
          .send({ message: "Option not found in the specified question." });
      }

      return response
        .status(200)
        .send({ message: `Option (ID: ${optionId}) successfully removed.` });
    } catch (error) {
      const message = errorHandler(error);
      return response.status(500).send({
        message: "Failed to delete option.",
        error: message,
        technical_code: error.code,
      });
    }
  }
);

export default router;
