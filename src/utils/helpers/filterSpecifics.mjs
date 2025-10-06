import fs from "fs";
import { resolve } from "path";

const dbFile = resolve("exam.json");

const fileData = JSON.parse(fs.readFileSync(dbFile, "utf-8"));

export const filterData = (identifier) => {
  let exams = [...fileData];

  if (/^\d+$/.test(identifier)) {
    exams = exams.filter((exam) => exam.id.toString() === identifier);
  } else {
    exams = exams.filter(
      (exam) =>
        exam.title &&
        exam.title.toLowerCase().includes(identifier.toLowerCase())
    );
  }

  if (exams.length > 0) {
    return exams.length === 1 ? exams[0] : exams;
  }

  return {error: "No exam found"}
};
