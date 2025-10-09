import { request, response, Router } from "express";
import { Data } from "../../utils/data/data.mjs";
import {
  checkSchema,
  matchedData,
  query,
  validationResult,
} from "express-validator";
import {
  loginSchema,
  signUpSchema,
} from "../../utils/middlewares/userValidationSchema.mjs";
import {
  comparePassword,
  hashPassword,
  passwordValidator,
} from "../../utils/helpers/passwordValidation.mjs";
import { emailValidator } from "../../utils/helpers/emailValidator.mjs";
import { sendMail } from "../../utils/helpers/mailer.mjs";
import { getConfirmationCode } from "../../utils/helpers/confirmationCode.mjs";
import { generateID } from "../../utils/helpers/generateID.mjs";
import pool from "../../utils/helpers/db.mjs";
import jwt from "jsonwebtoken";
import { validateSession } from "../../utils/middlewares/validateSession.mjs";

const router = Router();

const buildUserFeedback = (user) => ({
  userID: user.id,
  name: user.user.name,
  email: user.user.email,
  role: user.user.role,
  confirmed: user.user.confirmed,
  logged: user.user.logged,
  createdAt: user.createdAt,
});

// ------------------- ROUTES ----------------------------------//

// this route gets all the users
router.get("/users", validateSession,async (request, response) => {
  const fetch_query = "SELECT * FROM users";
  try {
    const result = await pool.query(fetch_query);

    return response
      .status(200)
      .send({ message: "Successfully fetched", data: result.rows });
  } catch (error) {
    console.error("Error fetching users:", error);
    response.status(500).send({ message: "Server error." });
  }
});

//this route is to get specific user by name / email
router.get("/user/:identifier", async (request, response) => {
  const { identifier } = request.params;

  try {
    //Determine the type of identifier and filter
    if (!identifier) {
      return response.status(400).send({ message: "Identifier is required." });
    }

    if (/^\d+$/.test(identifier)) {
      //If identifier is numeric, treat as id
      const query = "SELECT * FROM users WHERE id = $1";
      const result = await pool.query(query, [identifier]);

      if (result.rows.length === 0) {
        return response.status(404).send({ message: "User not found" });
      }

      return response
        .status(200)
        .send({ message: "Successfully fetched", data: result.rows });
    } else if (identifier.includes("@")) {
      //if identifier contains '@', treat it as an email
      const query = "SELECT * FROM users WHERE email = $1";

      const result = await pool.query(query, [identifier]);

      if (result.rows.length === 0) {
        return response.status(404).send({ message: "User not found" });
      }

      return response
        .status(200)
        .send({ message: "Successfully fetched", data: result.rows });
    } else {
      //Otherwise, treat it as a name
      const query = "SELECT * FROM users WHERE name = $1";

      const result = await pool.query(query, [identifier]);

      if (result.rows.length === 0) {
        return response.status(404).send({ message: "User not found" });
      }

      return response
        .status(200)
        .send({ message: "Successfully fetched", data: result.rows });
    }
  } catch (error) {
    console.error("An error occured:", error);
    return response
      .status(500)
      .send({ message: "An error occured", error: error });
  }
});

// ----- Post routes ------ //

// This route handles creating account
router.post(
  "/user/signup",
  checkSchema(signUpSchema),
  async (request, response) => {
    const { email, password, name } = request.body;
    const result = validationResult(request);
    const validatedEmail = emailValidator(email);
    const validatedPassword = passwordValidator(password);
    const insert_query =
      "INSERT INTO users (id, name, email, password_hashed, confirmed, role, is_logged_id, secret) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)";
    const filter_query = "SELECT email FROM users WHERE email = $1";
    const insert_confirmation_query =
      "INSERT INTO confirmation_tokens (id, user_id, otp, email_to_confirm, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6)";
    const emailExists = await pool.query(filter_query, [email]);

    try {
      if (!result.isEmpty() || !validatedEmail) {
        return response.status(400).send({ message: "Invalid Credentials" });
      }

      if (emailExists.rows.length > 0) {
        return response.status(409).send({ message: "Email already exists" });
      }
      if (!validatedPassword.valid) {
        return response.status(400).send({ error: validatedPassword.errors });
      }

      const newRequest = matchedData(request);
      newRequest.password = await hashPassword(password);

      // Generate OTP confirmation code
      const cc = getConfirmationCode(newRequest.email);

      const userid = generateID(9);
      const subject = "Welcome! Confirm your account";
      const text = `Enter this code to confirm your account: ${cc.otpCode}. This code expires in 2 minutes.`;
      const html = `<p>Enter this code to confirm your account: <strong>${cc.otpCode}</strong></p><p>This code expires in 2 minutes.</p>`;

      const mailSent = await sendMail(email, subject, text, html);
      if (!mailSent) {
        // You might want to log this or handle it differently
        console.error("Failed to send confirmation email.");
      }
      const newUser = {
        id: userid,
        user: {
          ...newRequest,
          confirmed: false,
          role: "Student",
          logged: false,
        },
        session: {
          cookieExpiration: request.session.cookie.expires?.toISOString(),
        },
        confirmation: {
          detail: cc,
          resendCount: 0,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date(),
      };

      request.session.user = {
        id: userid,
        name: newUser.user.name,
        email: newUser.user.email,
        role: "Student",
        confirmed: false,
        logged: false,
      };

      await pool.query(insert_query, [
        newUser.id,
        newRequest.name,
        newRequest.email,
        newRequest.password,
        newUser.user.confirmed,
        newUser.user.role,
        newUser.user.logged,
        "00000",
      ]);
      await pool.query(insert_confirmation_query, [
        cc.otpId,
        newUser.id,
        cc.otpCode,
        cc.email,
        cc.createdAt,
        cc.expiresAt,
      ]);

      return response.status(201).send({
        message: "Account created. Check your mail to confirm.",
        user: buildUserFeedback(newUser),
      });
    } catch (error) {
      console.error("Error:", error);
      return response.status(500).send(error);
    }
  }
);

// this route is verify user
router.post("/confirm-otp", async (request, response) => {
  const { code, email } = request.body;
  const query_match_otp =
    "SELECT * FROM confirmation_tokens WHERE email_to_confirm = $1 AND otp = $2";

  try {
    if (!email || !code) {
      return response
        .status(400)
        .send({ message: "Email and otp can't be empty" });
    }

    const email_matched = await pool.query(query_match_otp, [email, code]);
    if (email_matched.rows.length === 0) {
      return response
        .status(404)
        .send({ message: "No confirmation token found for this user" });
    }

    const token = email_matched.rows[0];

    if (new Date() > token.expires_at) {
      return response
        .status(400)
        .send({ message: "OTP has expired. Request new OTP" });
    }

    await pool.query(
      "UPDATE users SET confirmed = TRUE, is_logged_id = TRUE WHERE email = $1",
      [email]
    );

    await pool.query(
      "DELETE FROM confirmation_tokens WHERE email_to_confirm = $1",
      [email]
    );

    const userResult = await pool.query(
      "SELECT id, role FROM users WHERE email = $1",
      [email]
    );
    const user = userResult.rows[0];

    const jsonToken = jwt.sign(
      {
        userID: user.id,
        role: user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: "4h" }
    );
    return response
      .status(200)
      .send({ message: "Account confirmation successful", token: jsonToken });
  } catch (error) {
    console.error("An error occured:", error);
    return response
      .status(500)
      .send({ message: "An error occured", error: error });
  }
});

router.post("/resend-otp", (request, response) => {
  const { email } = request.body;
  const user = getUser(email);

  //configuration for sending mail
  const subject = "Request for new OTP Code";
  const currentTime = new Date().getTime();

  try {
    if (!user) {
      return response.status(404).send({ message: "User not found" });
    }

    if (user.confirmation.resendCount >= 3) {
      if (!user.confirmation.timerStart) {
        user.confirmation.timerStart = currentTime;
        writeData(fileData);
      }
      const elapsedTime =
        (currentTime - user.confirmation.timerStart) / 1000 / 60;
      if (elapsedTime < 5) {
        const remainingTime = 5 - elapsedTime;
        return response.status(429).send({
          message: `Resend limit exceeded. Try again after ${remainingTime.toFixed(
            2
          )} minutes.`,
        });
      } else {
        user.confirmation.resendCount = 0;
        delete user.confirmation.timerStart;
      }
    }

    const newOTP = getConfirmationCode(email);
    user.confirmation.detail = newOTP;
    user.confirmation.resendCount += 1;

    const mailText =
      `Your new OTP was generated at ${newOTP.createdAt} and your code is ${newOTP.otpCode}. If you made this request, copy paste the code within 2 minutes Code expires at ${newOTP.expiresAt}`.trim();

    writeData(fileData);

    // sendMail(email, subject, mailText, null);

    return response.status(200).send({
      message: `Successfully sent a new code check mail - ${
        3 - user.confirmation.resendCount
      } trials left`,
      code: user.confirmation.detail.otpCode,
      expires: user.confirmation.detail.expiresAt,
    });
  } catch (error) {
    console.error("From resend-otp, an error occured", error);
    return response.status(500).send({ error: `An error occured ${error}` });
  }
});

// this route is for logging in
router.post(
  "/user/login",
  checkSchema(loginSchema),
  async (request, response) => {
    const { email, password } = request.body;
    const result = validationResult(request);
    const validatedEmail = emailValidator(email);
    const validatedPassword = passwordValidator(password);
    const loggedUser = getUser(email);

    try {
      if (!result.isEmpty() || !validatedEmail) {
        return response.status(400).send({ message: "Invalid Credentials" });
      }

      if (!validatedPassword.valid) {
        return response
          .status(400)
          .send({ message: "Password doesn't meet requirements" });
      }

      if (!loggedUser) {
        return response
          .status(404)
          .send({ message: "User not found. Try creating a new account" });
      }

      const comparedPassword = await comparePassword(
        password,
        loggedUser.user.password
      );
      if (!comparedPassword) {
        return response
          .status(400)
          .send({ message: "Password doesn't match. Request a reset link" });
      }

      if (!loggedUser.user.confirmed) {
        return response.status(401).send({
          message: "You haven't confirmed this account. Can't log in",
        });
      }

      loggedUser.user.logged = true;
      writeData(fileData);

      request.session.user = {
        id: loggedUser.id,
        name: loggedUser.user.name,
        email: loggedUser.user.email,
        role: loggedUser.user.role,
        confirmed: loggedUser.user.confirmed,
        logged: true,
      };

      return response.status(200).send({
        message: "Login Successful",
        user: buildUserFeedback(loggedUser),
      });
    } catch (error) {
      console.error(error);
      return response.status(500).send(error);
    }
  }
);

router.patch("/edit", (request, response) => {
  const { email, name } = request.body;
  const user = getUser(email);

  if (!user) {
    return response.status(404).send({ message: "User not found" });
  }

  if (!name) {
    return response
      .status(400)
      .send({ message: "Name field cannot be left empty" });
  }

  //the code to check validity should come in here

  user.user.name = name;
  writeData(fileData);
  return response.status(200).send({ message: "Name has been changed" });
});

router.patch("/reset-password", async (request, response) => {
  const { password, email } = request.body;
  const user = getUser(email);
  const validatedPassword = passwordValidator(password);

  if (!user) {
    return response.status(404).send({ message: "User not found" });
  }

  if (!validatedPassword.valid) {
    return response.status(400).send({
      message: "Password does meet requirements",
      requirements: validatedPassword.errors,
    });
  }

  const hashedPassword = await hashPassword(password);
  user.user.password = hashedPassword;
  writeData(fileData);

  return response.status(200).send({ message: "Password has been changed" });
});

router.get("/user/session", (request, response) => {
  if (!request.session.user) {
    return response.status(401).send({ message: "Session expired" });
  }
  return response.status(200).send({ user: request.session.user });
});

export default router;

/*
• when handling a post request, we need this details
user email, name, password, subjects, role, signed in,

for url with queries to validate so, we need the query from express-validator
query('urlquery e.g filter).islenght()....
localhost:3000/90-tutorials.vercel.app/api/users?filter

if (!request.session) {
    return response.status(400).send({ message: "No session" });
  }
  if (request.session.cookie.expires < new Date()) {
    return response.status(400).send({ message: "Expired" });
  }
  if (!request.session.user) {
    return response.status(400).send({ message: "No session user" });
  }
*/
