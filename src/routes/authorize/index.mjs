import { Router } from "express";
import { resolve } from "path";
import fs from "fs";
import {
  generateRandomString,
  generateSequentialString,
} from "../../utils/helpers/generateID.mjs";

const router = Router();

const dbFile = resolve("authorize.json");
const examFile = resolve("exam.json");

if (!fs.existsSync(dbFile)) {
  fs.writeFileSync(dbFile, "[]");
}

const examData = JSON.parse(fs.readFileSync(examFile, "utf-8"));
const fileData = JSON.parse(fs.readFileSync(dbFile, "utf-8"));
const writeData = (data) => {
  fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));
};
const getAuthorizeExam = (title) => {
  const parsedTitle = title.toLowerCase();
  return fileData.find((exam) => exam.exam.toLowerCase() === parsedTitle);
};

router.get("/authorized", (request, response) => {
  if (fileData.length === 0) {
    return response.status(400).send({ message: "No Data to display" });
  }
  return response
    .status(200)
    .send({ message: "Fetch successful!", data: fileData });
});

router.post("/authorize-student", async (request, response) => {
  const { title, id } = request.body;
  const getExamByTitle = (name) => {
    const parsedTitle = name.toLowerCase();
    const found = examData.find(
      (exam) => exam.title.toLowerCase() === parsedTitle
    );
    return found ? found.title : null;
  };

  try {
    if (!title || typeof title !== "string") {
      return response
        .status(400)
        .send({ message: "Title must contain characters" });
    }

    const Exam = getExamByTitle(title);

    if (!Exam) {
      return response.status(404).send({ message: "Exam not found" });
    }

    if (!id || typeof id !== "string") {
      return response
        .status(400)
        .send({ message: "Must provide identify for id" });
    }

    const newData = {
      id: id,
      exam: Exam,
      students: []
    };

    fileData.push(newData);
    writeData(fileData);
    return response
      .status(200)
      .send({ message: "Succefully authorized students", data: newData });
  } catch (error) {
    console.error("An error occured:", error);
    return response.status(500).send({ message: "An error occured" });
  }
});

router.post("/authorize-student/email", (request, response) => {
  const { emails, title } = request.body;
  const authorized = getAuthorizeExam(title);

  try {
    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return response
        .status(400)
        .send({ message: "You must provide student's email(s)" });
    }

    if (authorized) {
      const existingMails = authorized.students.map((s) => s.email);
      const newEmails = emails.filter(
        (email) => !existingMails.includes(email)
      );
      const ID = authorized.id;

      if (newEmails.length > 0) {
        newEmails.forEach((studentEmail, index) => {
          const newStudent = {
            id: generateSequentialString(ID, title, 4, index),
            email: studentEmail,
          };
          authorized.students.push(newStudent);
        });

        writeData(fileData);

        return response.status(200).send({
          message: "Successfully added user(s) to existing exam",
          data: authorized,
        });
      }

      return response
        .status(200)
        .send({
          message: "All provided emails already exist",
          data: authorized,
        });
    }

    return response.status(400).send({ message: "Operation not allowed" });
  } catch (error) {
    console.error(error);
    return response.status(500).send({
      message: "An error occurred",
      error: error.message || error,
    });
  }
});


router.patch("/authorize-student", (request, response) => {
  const { title, students, id } = request.body;

  try {
    if (!id) {
      return response
        .status(400)
        .send({ message: "Id must not be left empty" });
    }

    if (!title || typeof title !== "string") {
      return response
        .status(400)
        .send({ message: "Title must contain characters" });
    }

    const examAuthorized = getAuthorizeExam(title);
    if (!examAuthorized) {
      return response.status(404).send({ message: "Hasn't been created" });
    }

    if (!students) {
      return response
        .status(400)
        .send({ message: "Student's field cannot be left empty" });
    }

    const existingStudent = examAuthorized.students.find(
      (student) => student.id.toLowerCase() === id.toLowerCase()
    );

    if (!existingStudent) {
      return response.status(404).send({ message: "User doesn't exist" });
    }

    existingStudent.email = students;
    writeData(fileData);
    return response
      .status(200)
      .send({ message: "Successfully changed the students email" });
  } catch (error) {
    console.error("An error occured:", error);
    return response.status(500).send({ message: "Something went wrong" });
  }
});

router.delete("/authorize-student", (request, response) => {
  const { title, id } = request.body;
  const examAuthorized = getAuthorizeExam(title);
  const studentAuthorized = examAuthorized.students.find(
    (student) => student.id.toLowerCase() === id.toLowerCase()
  );

  try {
    if (!id || typeof id !== "string") {
      return response
        .status(400)
        .send({ message: "Must provide Student's ID" });
    }

    if (!title) {
      return response.status(400).send({ message: "Must provide exam title" });
    }

    if (!examAuthorized) {
      return response
        .status(404)
        .send({ message: "Exam doesn't exist in student authorization" });
    }

    if (!studentAuthorized) {
      return response
        .status(404)
        .send({ message: "Student doesn't exist for this exam" });
    }

    const del = examAuthorized.students.findIndex(
      (item) => item.id === studentAuthorized.id
    );
    if (del !== -1) {
      examAuthorized.students.splice(del, 1);
      writeData(fileData);
    }
    return response
      .status(200)
      .send({ message: "Successfully deleted Student's data" });
  } catch (error) {
    console.log(error);
    return response
      .status(500)
      .send({ message: "An error occured", error: error });
  }
});

export default router;
