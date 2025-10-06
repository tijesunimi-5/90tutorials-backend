import { resolve } from "path";
import fs from "fs";

const dbFile = resolve("authorize.json");

const fileData = JSON.parse(fs.readFileSync(dbFile, "utf-8"));

export function generateID(length) {
  const min = Math.pow(10, length - 1);
  const max = Math.pow(10, length) - 1;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function generateRandomString(prefix, length) {
  const year = new Date().getFullYear().toString().slice(2); // Get the last 2 digits of the year
  const chars = "0123456789";
  let str = `${prefix}/${year}/`;
  for (let i = 0; i < length; i++) {
    str += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return str;
}

export function generateSequentialString(prefix, name, length, index) {
  const parsedName = name.toLowerCase();
  const year = new Date().getFullYear().toString().slice(2);

  const existingAuthorization = fileData.find(
    (ex) => ex.exam.toLowerCase() === parsedName
  );

  let baseCount = 0;

  if (existingAuthorization && existingAuthorization.students.length > 0) {
    // Get valid numeric parts only
    const numericIDs = existingAuthorization.students
      .map((student) => {
        const parts = student.id?.split("/") || [];
        const lastPart = parts[parts.length - 1];
        const num = parseInt(lastPart, 10);
        return isNaN(num) ? null : num;
      })
      .filter((num) => num !== null);

    if (numericIDs.length > 0) {
      baseCount = Math.max(...numericIDs);
    }
  }

  const newCount = baseCount + index + 1;

  const id = `${prefix}/${year}/${String(newCount).padStart(length, "0")}`;
  return id;
}


export function generateSequentialID(filteredExam, subject) {
  const currentID = filteredExam.subjects.find(
    (sub) => sub.name.toLowerCase() === subject.toLowerCase()
  ).questions.length;

  const nextID = currentID ? currentID + 1 : 1;

  return nextID;
}

export function regenerateSequentialID(length) {
  

  const nextID = length + 1
  return nextID
}

export function generateAlphabetID(index) {
  const quotient = Math.floor(index / 26);
  const remainder = index % 26;
  if (quotient === 0) {
    return String.fromCharCode(65 + remainder)
  } else {
    return String.fromCharCode(65 + quotient - 1) + String.fromCharCode(65 + remainder)
  }
}