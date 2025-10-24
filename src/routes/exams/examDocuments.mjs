import { response, Router } from "express";
import {
  generateAlphabetID,
  generateID,
  generateSequentialID,
  regenerateSequentialID,
} from "../../utils/helpers/generateID.mjs";
import { filterData } from "../../utils/helpers/filterSpecifics.mjs";
import { validateSession } from "../../utils/middlewares/validateSession.mjs";
import pool from "../../utils/helpers/db.mjs";
import { errorHandler } from "../../utils/helpers/errorHandler.mjs";

const router = Router();

const getExam = async (id) => {
  const fetch_query = `SELECT * FROM examinations WHERE exam_id = $1`;
  const fetch_by_name_query = `SELECT * FROM examinations WHERE title = $1`;

  try {
    const result = [];

    if (/^\d+$/.test(id)) {
      const fetchResult = (await pool.query(fetch_query, [id])).rows[0];

      if (!fetchResult) {
        return { message: "No exam found" };
      }

      result.push(fetchResult);
    } else {
      const fetchResult = (await pool.query(fetch_by_name_query, [id])).rows[0];

      if (!fetchResult) {
        return { message: "No exam found" };
      }
      result.push(fetchResult);
    }

    return result;
  } catch (error) {
    console.error("Failed to fetch:", error);
    const message = errorHandler(error);
    return response.status(500).send({
      message: "Failed to fetch:",
      error: message,
      technical_code: error.code && error.detail,
    });
  }
};

// ------------------------------- ALL EXAM ROUTES GOES IN HERE ---------------------------

router.get("/all-exams", validateSession, async (request, response) => {
  const fetch_query = `SELECT e.exam_id, e.title, e.duration_minutes, e.created_at, c.name AS category_name FROM examinations e JOIN exam_categories c ON e.category_id = c.category_id ORDER BY e.created_at DESC;
`;

  try {
    const result = (await pool.query(fetch_query)).rows;

    if (result.length === 0) {
      return response.status(404).send({ message: "No examination found.." });
    }

    return response
      .status(200)
      .send({ message: "Examinations fetched", data: result });
  } catch (error) {
    console.error("An error occured:", error);
    const message = errorHandler(error);
    return response.status(500).send({
      message: "An error occured",
      error: message,
      technical_code: error.code,
    });
  }
});

router.get("/exams/:identifier", validateSession, async (request, response) => {
  console.log(
    "------------------- THIS LOG IS FROM FILTERING EXAMS BY TITLE AND ID -----------------------"
  );
  const { identifier } = request.params;

  try {
    if (!identifier) {
      return res.status(400).json({ message: "Identifier is required." });
    }

    const result = await getExam(identifier);
    if (result.message) {
      return response.status(404).send({ message: result.message });
    }
    return response.status(200).send({ message: "Exam fetched", data: result });
  } catch (error) {
    console.error(error);
    const message = errorHandler(error);
    return response.status(500).send({
      message: "An error occured",
      error: message,
      technical_code: error.code,
    });
  }
});

router.post("/exam", validateSession, async (request, response) => {
  console.log(
    "--------------- THIS LOG IS FROM CREATING EXAM ROUTE -----------------"
  );
  const { title, duration, category } = request.body;
  const insert_exam_query = `INSERT INTO examinations (title, duration_minutes, category_id) VALUES ($1, $2, $3) RETURNING *`;

  try {
    if (!title || !duration) {
      return response
        .status(400)
        .send({ message: "Title and duration cannot be left empty" });
    }

    if (typeof duration !== "number") {
      return response
        .status(400)
        .send({ message: "Duration must be a number" });
    }

    if (!category) {
      return response
        .status(400)
        .send({ message: "Category cannot be an empty character" });
    }

    const result = (
      await pool.query(insert_exam_query, [title, duration, category])
    ).rows[0];

    return response
      .status(201)
      .send({ message: "Exam has successfully been added", data: result });
  } catch (error) {
    console.error(error);
    const message = errorHandler(error);
    return response.status(500).send({
      message: "An error occured",
      error: message,
      technical_code: error.code,
    });
  }
});

router.patch("/exam/:id/edit", validateSession, async (request, response) => {
  console.log(
    "----------------- LOG FROM EDITING EXAM DOCUMENT ----------------------"
  );
  const { id } = request.params;
  const updates = request.body;
  const exam = getExam(parseInt(id));

  try {
    if (!exam) {
      console.log("Exam doesn't exist")
      console.log("Exam is", exam)
    }
    

    return response.status(200).send({ message: "Still under construction."})
  } catch (error) {
    console.log("An error occured", error)
    const message = errorHandler(error)
    return response.status(500).send({ message: "An error occured", error: message}) 
  }
});

router.post("/exam/:id/subjects", validateSession, (request, response) => {
  console.log("------------ LOG FROM SUBJECT CREATION ---------------------");
  const { id } = request.params;
  const { subjectName } = request.body;
  const filteredExam = filterData(id);
  const existingSubjects = filteredExam.subjects.map((subject) => subject.name);
  const newSubjects = subjectName.filter((n) => !existingSubjects.includes(n));

  const uniqueSubjects = [
    ...new Set(newSubjects.map((subject) => subject.toLowerCase())),
  ].map((subject) => {
    return newSubjects.find((s) => s.toLowerCase() === subject);
  });

  try {
    if (uniqueSubjects.length === 0) {
      return response
        .status(400)
        .send({ message: "No valid subjects provided" });
    } else {
      const validSubjects = uniqueSubjects.filter(
        (subject) => subject.trim() !== ""
      );

      validSubjects.forEach((name) => {
        filteredExam.subjects.push({ name, questions: [] });
      });
      const foundExam = getExamById(id);
      foundExam.subjects = filteredExam.subjects;
      writeData(fileData);
    }
    return response
      .status(201)
      .send({ message: "Successfully added", added: fileData });
  } catch (error) {
    console.error(error);
    return response
      .status(500)
      .send({ message: "An error occured", error: error });
  }
});

router.patch(
  "/exam/:id/subjects/:name",
  validateSession,
  (request, response) => {
    console.log("------------- LOG FROM EXAM SUBJECT EDITS ----------------");
    const { id, name } = request.params;
    const { subjectName } = request.body;
    const exam = getExamById(id);

    try {
      if (
        !exam.subjects.find((subject) =>
          subject.name.toLowerCase().includes(name.toLowerCase())
        )
      ) {
        return response
          .status(404)
          .send({ message: "Subject not found in exam docs" });
      }

      if (
        !subjectName ||
        typeof subjectName !== "string" ||
        subjectName.trim() === ""
      ) {
        return response.status(400).send({
          message: "Subject name must be provided and it must be characters",
        });
      }

      const foundSub = exam.subjects.find((subject) =>
        subject.name.toLowerCase().includes(name.toLowerCase())
      );
      foundSub.name = subjectName;
      writeData(fileData);
      return response.status(200).send({
        message: "Subject name has successfully been changed",
        "The exam": exam,
      });
    } catch (error) {
      console.error(error);
      return response
        .status(500)
        .send({ message: "An error occured", error: error });
    }
  }
);

router.post(
  "/exam/:id/subjects/:name/questions",
  validateSession,
  (request, response) => {
    console.log(
      "----------------- LOGS FOR ADDING QUESTIONS TO EXAM -----------------"
    );
    const { id, name } = request.params;
    const { question, options, answer } = request.body;
    const filteredExam = getExamById(id);
    const filteredSubject = filteredExam.subjects.filter(
      (n) => n.name.toLowerCase() === name.toLowerCase()
    );

    try {
      if (!filteredSubject || filteredSubject.length === 0) {
        return response
          .status(404)
          .send({ message: "Couldn't add questions, subject nt found" });
      }

      if (!question || !answer || !options) {
        return response
          .status(400)
          .send({ message: "Missing required fields" });
      }

      // if (!Array.isArray(options)) {
      //   return response
      //     .status(400)
      //     .send({ message: "Make sure the options is more than one" });
      // }
      let lastIndex = 0;

      const option = [];
      const optionString = String(options);
      const oppt = optionString
        .split("\n")
        .map((opt) => opt.trim())
        .filter((opt) => opt);

      oppt.map((opt) => {
        const id = generateAlphabetID(lastIndex);
        const text = opt;
        lastIndex++;
        option.push({ id: id, text: text });
      });

      const newQuestion = {
        id: generateSequentialID(filteredExam, name),
        question: question,
        options: option,
        answer: answer,
      };

      filteredSubject.find((que) => que.questions).questions.push(newQuestion);
      writeData(fileData);

      return response
        .status(201)
        .send({ message: "Saved", data: filteredExam });
    } catch (error) {
      console.error(error);
      return response.status(500).send({ message: "An error occured", error });
    }
  }
);

router.post(
  "/exam/:id/subjects/:name/questions/:Qid",
  validateSession,
  (request, response) => {
    const { id, name, Qid } = request.params;
    const { option } = request.body;
    const filteredExam = getExamById(id);
    const filteredSubject = filteredExam.subjects.filter(
      (n) => n.name.toLowerCase() === name.toLowerCase()
    );
    const filteredQuestion = filteredSubject.find(
      (question) => question.questions
    );
    const filteredQuestionById = filteredQuestion.questions.find(
      (id) => id.id === parseInt(Qid)
    );

    try {
      console.log();
      if (!filteredQuestionById) {
        return response.status(404).send({
          message: "The question you're tryinng to access doesn't exist",
        });
      }

      if (!option) {
        return response
          .status(400)
          .send({ message: "Option cannot be left empty!" });
      }

      let index = filteredQuestionById.options.length;
      const newOption = {
        id: generateAlphabetID(index),
        text: option,
      };
      filteredQuestionById.options.push(newOption);
      writeData(fileData);

      return response
        .status(200)
        .send({ message: "Successfully added option" });
    } catch (error) {
      console.error(error);
      return response
        .status(500)
        .send({ message: "An error occured", error: error });
    }
  }
);

router.patch(
  "/exam/:id/subjects/:name/questions/:Qid",
  validateSession,
  (request, response) => {
    console.log(
      "-------------- LOGS FROM EDITING SUBJECT QUESTIONS -----------------"
    );
    const { id, name, Qid } = request.params;
    const { question } = request.body;
    const filteredExam = getExamById(id);
    const filteredSubject = filteredExam.subjects.filter(
      (n) => n.name.toLowerCase() === name.toLowerCase()
    );
    const filteredQuestion = filteredSubject.find(
      (question) => question.questions
    );
    const filteredQuestionById = filteredQuestion.questions.find(
      (id) => id.id === parseInt(Qid)
    );

    try {
      if (!filteredQuestionById) {
        return response.status(404).send({
          message: "Question doesn't exist, can't perform any operation",
        });
      }

      if (question) {
        filteredQuestionById.question = question;
        writeData(fileData);
      }

      return response.status(200).send({
        message: "Successully changed the question",
        data: filteredQuestionById,
      });
    } catch (error) {
      console.error(error);
      return response
        .status(500)
        .send({ message: "An error occured", error: error });
    }
  }
);

router.patch(
  "/exam/:id/subjects/:name/questions/:Qid/options/:Oid",
  validateSession,
  (request, response) => {
    const { id, name, Qid, Oid } = request.params;
    const { option, answer } = request.body;

    const filteredExam = getExamById(id);
    const filteredSubject = filteredExam.subjects.find(
      (n) => n.name.toLowerCase() === name.toLowerCase()
    );
    const filteredQuestionById = filteredSubject.questions.find(
      (question) => question.id === parseInt(Qid)
    );
    // console.log(filteredSubject)
    const filteredOptionById = filteredQuestionById.options.find(
      (opt) => opt.id.toLowerCase() === Oid.toLowerCase()
    );

    try {
      // if (!option) {
      //   return response.status(400).send({ message: "Must provide a value" });
      // }

      if (answer) {
        const filteredAnswer = filteredSubject.questions.find(
          (ans) => ans.id === parseInt(Qid)
        );
        filteredAnswer.answer = answer;
        writeData(fileData);
        return response.status(200).send({ message: "Answer changed" });
      }

      filteredOptionById.text = option;
      writeData(fileData);

      return response.status(200).send({
        message: "Fields successfully updated",
        data: filteredQuestionById,
      });
    } catch (error) {
      console.error("An error occured:", error);
      return response
        .status(500)
        .send({ message: "An error occured", error: error });
    }
  }
);

router.delete("/exam/:id", validateSession, (request, response) => {
  const { id } = request.params;
  const examIndex = getExamById(id);

  if (!examIndex) {
    return response
      .status(404)
      .send({ message: "No exam found - ID doesn't exist" });
  }
  fileData = fileData.filter((questions) => questions.id !== examIndex.id);
  writeData(fileData);
  return response.status(200).send({ message: "Successfully removed" });
});

router.delete(
  "/exam/:id/subjects/:name/questions/:Qid",
  validateSession,
  (request, response) => {
    const { id, name, Qid } = request.params;
    const exam = getExamById(id);
    const subject = exam.subjects.find(
      (sub) => sub.name.toLowerCase() === name.toLowerCase()
    );
    let question = subject.questions.find(
      (question) => question.id === parseInt(Qid)
    );

    if (!id || !name || !Qid) {
      return response.status(400).send({ message: "Missing requirements" });
    }
    subject.questions = subject.questions.filter((qs) => qs.id !== question.id);

    let length = 0;
    subject.questions.forEach((question) => {
      question.id = regenerateSequentialID(length);
      length++;
    });
    writeData(fileData);
    return response.status(200).send({ message: "Successfully removed" });
  }
);

//
router.delete(
  "/exam/:id/subjects/:name/questions/:Qid/options/:Oid",
  validateSession,
  (request, response) => {
    const { id, name, Qid, Oid } = request.params;
    const exam = getExamById(id);
    const subject = exam.subjects.find(
      (sub) => sub.name.toLowerCase() === name.toLowerCase()
    );
    let question = subject.questions.find(
      (question) => question.id === parseInt(Qid)
    );
    let options = question.options.find(
      (opt) => opt.id.toLowerCase() === Oid.toLowerCase()
    );

    if (!id || !name || !Qid || !Oid) {
      return response.status(400).send({ message: "Missing a required field" });
    }
    question.options = question.options.filter(
      (opt) => opt.id.toLowerCase() !== options.id.toLowerCase()
    );

    let newIndex = 0;
    question.options.forEach((option) => {
      option.id = generateAlphabetID(newIndex);
      newIndex++;
    });

    writeData(fileData);
    return response.status(200).send({ message: "Successfully removed" });
  }
);

router.delete(
  "/exam/:id/subjects/:name",
  validateSession,
  (request, response) => {
    const { id, name } = request.params;
    const exam = getExamById(id);
    const subject = exam.subjects.find(
      (sub) => sub.name.toLowerCase() === name.toLowerCase()
    );

    console.log(subject);

    if (!id || !name) {
      return response.status(400).send({ message: "Missing requirements" });
    }
    exam.subjects = exam.subjects.filter(
      (subName) => subName.name.toLowerCase() !== subject.name.toLowerCase()
    );

    writeData(fileData);
    return response.status(200).send({ message: "Successfully removed" });
  }
);

//------------------ Categories ---------------------- //
router.post("/category", validateSession, async (request, response) => {
  console.log(
    "-------------------- Category Route ---------------------------"
  );
  const { categories } = request.body;
  const fetch_category_query = `SELECT * FROM exam_categories WHERE name = $1`;
  const query = `INSERT INTO exam_categories (name) VALUES ($1) RETURNING category_id`;

  if (!categories || typeof categories !== "string") {
    return response.status(400).send({ message: "Provide a category." });
  }

  try {
    const exists = (await pool.query(fetch_category_query, [categories]))
      .rows[0];

    if (exists) {
      return response.status(400).send({ message: "Category exists" });
    }

    const result = (await pool.query(query, [categories])).rows[0];

    return response
      .status(201)
      .send({ message: "Category added", data: result });
  } catch (error) {
    console.error("An error occured:", error);
    return response
      .status(500)
      .send({ message: "Network error, please try again", error: error });
  }
});

router.get("/categories", validateSession, (request, response) => {
  return response
    .status(200)
    .send({ message: "Fetched Successfully", data: "works" });
});

router.delete("/delete-category/:index", (request, response) => {
  const index = parseInt(request.params.index);

  if (isNaN(index) || index < 0 || index >= catData.length) {
    return response.status(400).send({ message: "Invalid Index" });
  }
  catData.splice(index, 1);
  return response
    .status(200)
    .send({ message: "Successfully deleted", data: catData });
});

export default router;
