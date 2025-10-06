import { request } from "express";
import fs from "fs";
import { resolve } from "path";

const db = resolve("db.json");

const fileData = JSON.parse(fs.readFileSync(db, "utf-8"));
const writeData = (data) => {
  fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));
};

const exceptions = ["/api/users/login", "/api.users/signup"];

export const validateSession = (request, response, next) => {
  console.log("------- VALIDATE SESSION LOG --------");
  console.log(request.sessionID)
  //Update session expiration time
  const user = fileData.find((user) => user.sessionID === request.sessionID);
  console.log(user);
  if (exceptions.includes(request.path)) {
    return next();
  }

  if (!request.session || !request.session.user) {
    return response.status(401).send({ message: "Unauthorized access" });
  }
};
