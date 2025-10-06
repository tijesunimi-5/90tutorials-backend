import { request, response, Router } from "express";
import { checkSchema, validationResult } from "express-validator";
import { loginSchema } from "../../utils/middlewares/userValidationSchema.mjs";
import { emailValidator } from "../../utils/helpers/emailValidator.mjs";
import {
  comparePassword,
  passwordValidator,
  secretValidator,
} from "../../utils/helpers/passwordValidation.mjs";
import fs from "fs";
import { resolve } from "path";

const router = Router();
const db = resolve("db.json");
//initialize the database file if it doesn't exist
if (!fs.existsSync(db)) {
  fs.writeFileSync(db, "[]");
}
const fileData = JSON.parse(fs.readFileSync(db, "utf-8"));
const writeData = (data) => {
  fs.writeFileSync(db, JSON.stringify(data, null, 2));
};
const getUser = (email) => {
  return fileData.find((user) => user.user.email === email);
};

// -------------------- ALL ROUTES STARTS HERE --------------------

router.get("/admin", (request, response) => {
  return response
    .status(200)
    .send({ message: "You've just made a request to 90+ OBT admin endpoint" });
});

router.post(
  "/admin/login",
  checkSchema(loginSchema),
  async (request, response) => {
    console.log(" ----------------- ADMIN LOGIN ROUTE LOGS -----------------");
    const { email, password } = request.body;
    const result = validationResult(request);
    const validatedEmail = emailValidator(email);
    const validatedPassword = passwordValidator(password);
    const loggedAdmin = getUser(email);
    console.log(email)

    try {
      if (!result.isEmpty() || !validatedEmail) {
        return response.status(400).send({ message: "Invalid Credentials" });
      }

      if (!validatedPassword.valid) {
        return response.status(400).send({
          message: "Password doesn't meet requirements",
          requirements: validatedPassword.errors,
        });
      }

      const comparedPassword = await comparePassword(
        password,
        loggedAdmin.user.password
      );

      if (!comparedPassword) {
        return response.status(400).send({ message: "Password is incorrect." });
      }

      if (loggedAdmin.user.role !== "Admin") {
        return response
          .status(400)
          .send({ message: "You're not authorized to access this page" });
      }

      if (!loggedAdmin.user.confirmed) {
        return response
          .status(400)
          .send({ message: "Your account is not confirmed." });
      }

      if (!loggedAdmin.user.logged) {
        loggedAdmin.user.logged = true;
        const Admin = {
          name: loggedAdmin.user.name,
          email: loggedAdmin.user.email,
          role: loggedAdmin.user.role,
          logged: loggedAdmin.user.logged,
          confirmed: loggedAdmin.user.confirmed,
        };
        writeData(fileData);
        return response
          .status(200)
          .send({ message: "Login Successfull", data: Admin });
      }

      const Admin = {
        id: loggedAdmin.id,
        name: loggedAdmin.user.name,
        email: loggedAdmin.user.email,
        role: loggedAdmin.user.role,
        logged: loggedAdmin.user.logged,
        confirmed: loggedAdmin.user.confirmed,
        secret: loggedAdmin.user.secret,
      };

      return response
        .status(200)
        .send({ message: "Login Successful", data: Admin });
    } catch (error) {
      console.error(error);
      return response.status(500).send({ error: error });
    }
  }
);

router.post("/admin/secret", (request, response) => {
  console.log(" ----------- ADMIN SECRET LOG -------------");
  console.log(
    " -------- THIS ROUTE IS TO SET SECRET CODE IF NOT SETTED AND VALIDATE IF SET ------------"
  );
  const { secret, email } = request.body;
  const admin = getUser(email);
  const validatedSecret = secretValidator(secret);

  try {
    if (!admin) {
      return response
        .status(401)
        .send({ message: "You're not authorized to access this page." });
    }

    if (!validatedSecret.valid) {
      return response.status(400).send({
        message: "Secret doesn't meet requirement",
        requirement: validatedSecret.errors,
      });
    }

    if (admin.user.secret === null) {
      console.log("admin secret doesn't exist");
      admin.user.secret = secret;
      writeData(fileData);
      return response.status(200).send({ message: "Secret has been added" });
    }

    if (admin.user.secret !== secret) {
      return response.status(401).send({ message: "Secret doesn't match!" });
    }

    return response.status(200).send({ message: "Secret as been added" });
  } catch (error) {
    console.error("An error occured:", error);
    return response
      .status(500)
      .send({ message: "An error occured", error: error });
  }
});

export default router;
