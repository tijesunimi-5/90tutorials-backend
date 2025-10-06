import { response, Router } from "express";
import { Exam } from "../../utils/data/examData.mjs";
import fs from "fs";
import { resolve } from "path";
import {
  generateAlphabetID,
  generateID,
  generateSequentialID,
  regenerateSequentialID,
} from "../../utils/helpers/generateID.mjs";
import { filterData } from "../../utils/helpers/filterSpecifics.mjs";

const router = Router();
const examData = Exam;

//this function here is to prepare a file for temporary database
const dbFile = resolve("exam.json");
const catFile = resolve("cat.json");

//initialize the database file if it doesn't exist
if (!fs.existsSync(dbFile)) {
  fs.writeFileSync(dbFile, "[]");
}
let fileData = JSON.parse(fs.readFileSync(dbFile, "utf-8"));
const writeData = (data) => {
  fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));
};

if (!fs.existsSync(catFile)) {
  fs.writeFileSync(catFile, "[]");
}
const catData = JSON.parse(fs.readFileSync(catFile, "utf-8"));
const writeCatData = (data) => {
  fs.writeFileSync(catFile, JSON.stringify(data, null, 2));
};

const getExam = (title) => {
  const parsedTitle = title.toLowerCase();
  return fileData.find((exam) => exam.title.toLowerCase() === parsedTitle);
};

const getExamById = (id) => {
  const parsedID = parseInt(id);
  return fileData.find((exam) => exam.id === parsedID);
};

// ------------------------------- ALL EXAM ROUTES GOES IN HERE ---------------------------

router.get("/all-exams", (request, response) => {
  if (!fileData.length) {
    return response.status(400).send({ message: "Exam database is empty" });
  }
  return response.status(200).send({ exam: fileData });
});

router.get("/exams/:identifier", (request, response) => {
  console.log(
    "------------------- THIS LOG IS FROM FILTERING EXAMS BY TITLE AND ID -----------------------"
  );
  const { identifier } = request.params;

  try {
    if (!identifier) {
      return res.status(400).json({ message: "Identifier is required." });
    }

    let exams = [...fileData];

    if (/^\d+$/.test(identifier)) {
      // numeric = ID
      exams = exams.filter((exam) => exam.id.toString() === identifier);
    } else {
      // string = title search
      exams = exams.filter(
        (exam) =>
          exam.title &&
          exam.title.toLowerCase().includes(identifier.toLowerCase())
      );
    }

    if (exams.length > 0) {
      return response.status(200).json(exams.length === 1 ? exams[0] : exams);
    }
    return response.status(404).json({ message: "No exam found!" });
  } catch (error) {
    console.error(error);
    return response.status(500).send({ error: error });
  }
});

router.post("/exam", (request, response) => {
  console.log(
    "--------------- THIS LOG IS FROM CREATING EXAM ROUTE -----------------"
  );
  const { title, duration, category } = request.body;
  const existingExam = getExam(title);

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

    if (!category || typeof category !== "string") {
      return response
        .status(400)
        .send({ message: "Category cannpt be an empty character" });
    }

    if (existingExam) {
      return response.status(400).send({
        message: "Exam with the same title exists. Consider changing the title",
      });
    }

    const examData = {
      id: generateID(6),
      title: title,
      duration: duration,
      category: category,
      subjects: [],
      createdAt: new Date().toISOString(),
    };

    fileData.push(examData);
    writeData(fileData);

    return response
      .status(201)
      .send({ message: "Exam has successfully been added", exam: examData });
  } catch (error) {
    console.error(error);
    return response.status(500).send({ message: "An error occured", error });
  }
});

router.patch("/exam/:identifier/edit", (request, response) => {
  console.log(
    "----------------- LOG FROM EDITING EXAM DOCUMENT ----------------------"
  );
  const { identifier } = request.params;
  const updates = request.body;
  const result = filterData(identifier);
  const titles = updates.title;
  const existing = getExamById(identifier);

  try {
    if (result.error) {
      return response.status(400).send({ message: result.error });
    }

    if (updates.title) {
      existing.title = titles;
      console.log("A new Exam title was provided and has been set.");
    }

    if (updates.duration && typeof updates.duration !== "number") {
      return response
        .status(400)
        .send({ message: "Duration must be a number" });
    }

    if (updates.duration) {
      existing.duration = updates.duration;
      console.log("A new duration has been provided and has been changed");
    }
    if (updates.category) {
      existing.category = updates.category;
      console.log("A new category has been added");
    }

    writeData(fileData);
    return response
      .status(200)
      .send({ message: "All changes made", exam: fileData });
  } catch (error) {
    console.error(error);
    return response.status(500).send({ error: error });
  }
});

router.post("/exam/:id/subjects", (request, response) => {
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

router.patch("/exam/:id/subjects/:name", (request, response) => {
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
});

router.post("/exam/:id/subjects/:name/questions", (request, response) => {
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
      return response.status(400).send({ message: "Missing required fields" });
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

    return response.status(201).send({ message: "Saved", data: filteredExam });
  } catch (error) {
    console.error(error);
    return response.status(500).send({ message: "An error occured", error });
  }
});

router.post("/exam/:id/subjects/:name/questions/:Qid", (request, response) => {
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
      return response
        .status(404)
        .send({
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

    return response.status(200).send({ message: "Successfully added option" });
  } catch (error) {
    console.error(error);
    return response
      .status(500)
      .send({ message: "An error occured", error: error });
  }
});

router.patch("/exam/:id/subjects/:name/questions/:Qid", (request, response) => {
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
});

router.patch(
  "/exam/:id/subjects/:name/questions/:Qid/options/:Oid",
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

router.delete("/exam/:id", (request, response) => {
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

router.delete("/exam/:id/subjects/:name", (request, response) => {
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
});

//------------------ Categories ---------------------- //
router.post("/set-category", (request, response) => {
  console.log(
    "-------------------- Category Route ---------------------------"
  );
  const { categories } = request.body;
  const exists = catData.find(
    (cat) => cat.toLowerCase() === categories.toLowerCase()
  );
  console.log(exists);

  if (exists) {
    return response.status(400).send({ message: "Category exists already" });
  }

  try {
    if (!categories) {
      return response
        .status(400)
        .send({ message: "Categories can't be left empty" });
    }

    catData.push(categories);
    writeCatData(catData);

    return response
      .status(201)
      .send({ message: "Successfully added", data: catData });
  } catch (error) {}
});

router.get("/categories", (request, response) => {
  return response
    .status(200)
    .send({ message: "Fetched Successfully", data: catData });
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
