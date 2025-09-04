import { response, Router } from "express";
import { Exam } from "../utils/examData.mjs";
import { checkSchema, validationResult } from "express-validator";
import {
  examSchema,
  updateExamSchema,
} from "../utils/examValidationSchema.mjs";

const router = Router();
const examData = Exam;

router.get("/api/exams", (req, res) => {
  if (!Array.isArray(examData) || examData.length === 0) {
    return res.status(404).json({ message: "No exams available" });
  }
  return res.status(200).json(examData); // return array directly
});

router.get("/api/exams/:identifier", (req, res) => {
  const { identifier } = req.params;
  if (!identifier) {
    return res.status(400).json({ message: "Identifier is required." });
  }

  let exams = [...examData];

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
    return res.status(200).json(exams.length === 1 ? exams[0] : exams);
  }
  return res.status(404).json({ message: "No exam found!" });
});

// POST /api/exams
router.post("/api/exams", checkSchema(examSchema), (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { title, subjects } = req.body;

  const newExamId =
    examData.length > 0 ? Math.max(...examData.map((e) => e.id)) + 1 : 1;

  const newSubjects = subjects.map((subject, sIndex) => ({
    id: sIndex + 1,
    title: subject.title,
    questions: subject.questions.map((q, qIndex) => ({
      id: qIndex + 1,
      text: q.text,
      options: q.options,
      answer: q.answer,
      optionType: q.optionType,
    })),
  }));

  const newExam = { id: newExamId, title, subjects: newSubjects };
  examData.push(newExam);

  return res.status(201).json(newExam);
});

// PUT /api/exams/:id
router.put("/api/exams/:id", checkSchema(updateExamSchema), (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { id } = req.params;
  const { title, subjects } = req.body;

  const examIndex = examData.findIndex((exam) => exam.id.toString() === id);
  if (examIndex === -1) {
    return res.status(404).json({ message: "Exam not found" });
  }

  if (title) examData[examIndex].title = title;

  if (subjects) {
    subjects.forEach((subject) => {
      const existingSubjectIndex = examData[examIndex].subjects.findIndex(
        (s) => s.title === subject.title || s.id === subject.id
      );

      if (existingSubjectIndex !== -1) {
        // Merge new questions
        const existingSubject =
          examData[examIndex].subjects[existingSubjectIndex];
        const maxQId =
          existingSubject.questions.length > 0
            ? Math.max(...existingSubject.questions.map((q) => q.id))
            : 0;

        subject.questions.forEach((q, qIndex) => {
          const alreadyExists = existingSubject.questions.some(
            (qq) => qq.text === q.text || qq.id === q.id
          );
          if (!alreadyExists) {
            existingSubject.questions.push({
              id: maxQId + qIndex + 1,
              text: q.text,
              options: q.options,
              answer: q.answer,
              optionType: q.optionType,
            });
          }
        });
      } else {
        // Add new subject
        const maxSId =
          examData[examIndex].subjects.length > 0
            ? Math.max(...examData[examIndex].subjects.map((s) => s.id))
            : 0;
        examData[examIndex].subjects.push({
          id: maxSId + 1,
          title: subject.title,
          questions: subject.questions.map((q, qIndex) => ({
            id: qIndex + 1,
            text: q.text,
            options: q.options,
            answer: q.answer,
            optionType: q.optionType,
          })),
        });
      }
    });
  }

  return res.status(200).json(examData[examIndex]);
});

// DELETE whole exam
router.delete("/api/exams/:id", (req, res) => {
  const { id } = req.params;
  const examIndex = examData.findIndex((exam) => exam.id.toString() === id);
  if (examIndex === -1) {
    return res.status(404).json({ message: "Exam not found" });
  }
  const deleted = examData.splice(examIndex, 1)[0];
  return res
    .status(200)
    .json({ message: "Exam deleted successfully", deletedExam: deleted });
});

// DELETE a subject from an exam
router.delete("/api/exams/:id/subjects/:subjectId", (req, res) => {
  const { id, subjectId } = req.params;
  const exam = examData.find((e) => e.id.toString() === id);
  if (!exam) return res.status(404).json({ message: "Exam not found" });

  const sIndex = exam.subjects.findIndex((s) => s.id.toString() === subjectId);
  if (sIndex === -1)
    return res.status(404).json({ message: "Subject not found" });

  const deleted = exam.subjects.splice(sIndex, 1)[0];
  return res
    .status(200)
    .json({
      message: "Subject deleted successfully",
      deletedSubject: deleted,
      exam,
    });
});

// DELETE a question from a subject
router.delete(
  "/api/exams/:id/subjects/:subjectId/questions/:questionId",
  (req, res) => {
    const { id, subjectId, questionId } = req.params;
    const exam = examData.find((e) => e.id.toString() === id);
    if (!exam) return res.status(404).json({ message: "Exam not found" });

    const subject = exam.subjects.find((s) => s.id.toString() === subjectId);
    if (!subject) return res.status(404).json({ message: "Subject not found" });

    const qIndex = subject.questions.findIndex(
      (q) => q.id.toString() === questionId
    );
    if (qIndex === -1)
      return res.status(404).json({ message: "Question not found" });

    const deleted = subject.questions.splice(qIndex, 1)[0];
    return res
      .status(200)
      .json({
        message: "Question deleted successfully",
        deletedQuestion: deleted,
        exam,
      });
  }
);


export default router;
