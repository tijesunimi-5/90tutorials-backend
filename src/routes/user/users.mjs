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
import { v4 as uuidv4 } from "uuid";
import passport from "passport";
import {
  comparePassword,
  hashPassword,
  passwordValidator,
} from "../../utils/helpers/passwordValidation.mjs";
import { emailValidator } from "../../utils/helpers/emailValidator.mjs";
import { sendMail } from "../../utils/helpers/mailer.mjs";
import { getConfirmationCode } from "../../utils/helpers/confirmationCode.mjs";
import { generateID } from "../../utils/helpers/generateID.mjs";
import fs from "fs";
import { resolve } from "path";

const router = Router();

//this variable holds all the users available in dummy data
const data = Data;
const resetTokens = {};

//this function here is to prepare a file for temporary database
const dbFile = resolve("db.json");

//initialize the database file if it doesn't exist
if (!fs.existsSync(dbFile)) {
  fs.writeFileSync(dbFile, "[]");
}
const fileData = JSON.parse(fs.readFileSync(dbFile, "utf-8"));
const writeData = (data) => {
  fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));
};
const getUser = (email) => {
  return fileData.find((user) => user.user.email === email);
};

const buildUserFeedback = (user) => ({
  userID: user.id,
  userSID: user.sessionID,
  name: user.user.name,
  email: user.user.email,
  role: user.user.role,
  confirmed: user.user.confirmed,
  logged: user.user.logged,
  createdAt: user.createdAt,
});

// ------------------- ROUTES ----------------------------------//

// this route gets all the users
router.get("/users", (request, response) => {
  // console.log(request.cookies);
  // if (request.cookies.hello && request.cookies.hello === "world")
  //   return response.send([{ data, statusbar: 200 }]);

  // console.log(request.session.id);
  // request.sessionStore.get(request.session.id, (err, sessionData) => {
  //   if (err) {
  //     console.log(err);
  //     throw err;
  //   }
  //   console.log(sessionData);
  // });

  response.status(200).send(fileData);

  // return response.send({ msg: "Sorry, you need to obtain the correct cookie" });
});

//this route is to get specific user by name / email
router.get("/user/:identifier", (request, response) => {
  const { identifier } = request.params;
  let result = [...data];

  //Determine the type of identifier and filter
  if (!identifier) {
    return response.status(400).send({ message: "Identifier is required." });
  }

  if (/^\d+$/.test(identifier)) {
    //If identifier is numeric, treat as id
    result = result.filter(
      (user) => user.id && user.id.toString() === identifier
    );
  } else if (identifier.includes("@")) {
    //if identifier contains '@', treat it as an email
    result = result.filter(
      (user) =>
        user.email &&
        typeof user.email === "string" &&
        user.email.toLowerCase() === identifier.toLowerCase()
    );
  } else {
    //Otherwise, treat it as a name
    result = result.filter(
      (user) =>
        user.name &&
        typeof user.name === "string" &&
        user.name.toLowerCase().includes(identifier.toLowerCase())
    );
  }

  if (result.length > 0) {
    return response.send(result);
  } else {
    return response.status(404).send({ message: "No user found" });
  }
});

// ----- Post routes ------ //

// This route handles creating account
router.post("/user/signup", checkSchema(signUpSchema), async (request, response) => {
  const { email, password, name } = request.body;
  const result = validationResult(request);
  const validatedEmail = emailValidator(email);
  const validatedPassword = passwordValidator(password);
  const existingUser = getUser(email);

  try {
    if (!result.isEmpty() || !validatedEmail) {
      return response.status(400).send({ message: "Invalid Credentials" });
    }

    if (existingUser) {
      return response.status(401).send({ message: "This user already exists. Try logging in." });
    }

    if (!validatedPassword.valid) {
      return response.status(400).send({ error: validatedPassword.errors });
    }

    const newRequest = matchedData(request);
    newRequest.password = await hashPassword(password);

    // Generate OTP confirmation code
    const cc = await getConfirmationCode(newRequest.email);

    const userid = generateID(9);
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

    fileData.push(newUser);
    writeData(fileData);
    data.push(newUser);

    return response.status(201).send({
      message: "Account created. Check your mail to confirm.",
      user: buildUserFeedback(newUser),
    });
  } catch (error) {
    console.error("Error:", error);
    return response.status(500).send(error);
  }
});



// this route is verify user
router.post("/confirm-otp", (request, response) => {
  const { code, email } = request.body;
  const matchedUsid = fileData.find((user) => user.user.email === email);
  const matchedOTP = fileData.find(
    (user) => user.confirmation.detail.otpCode === parseInt(code)
  );

  try {
    if (!email || !code) {
      return response.status(400).send({ message: "Must provide session ID and OTP code" });
    }

    if (!matchedUsid) {
      return response.status(400).send({ message: "Session doesn't exist. Login to get a new sessionID" });
    }

    if (!matchedOTP) {
      return response.status(400).send({ message: "Confirmation code doesn't match." });
    }

    if (new Date(matchedUsid.confirmation.detail.expiresAt) < new Date()) {
      return response.status(400).send({ message: "OTP expired" });
    }

    matchedUsid.user.confirmed = true;
    matchedUsid.user.logged = true;
    writeData(fileData);

    request.session.user = {
      id: matchedUsid.id,
      name: matchedUsid.user.name,
      email: matchedUsid.user.email,
      role: matchedUsid.user.role,
      confirmed: true,
      logged: true,
    };

    return response.status(200).send({
      message: "OTP verified successfully.",
      user: buildUserFeedback(matchedUsid),
    });
  } catch (error) {
    console.error(error);
    return response.status(500).send(error);
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
router.post("/user/login", checkSchema(loginSchema), async (request, response) => {
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
      return response.status(400).send({ message: "Password doesn't meet requirements" });
    }

    if (!loggedUser) {
      return response.status(404).send({ message: "User not found. Try creating a new account" });
    }

    const comparedPassword = await comparePassword(password, loggedUser.user.password);
    if (!comparedPassword) {
      return response.status(400).send({ message: "Password doesn't match. Request a reset link" });
    }

    if (!loggedUser.user.confirmed) {
      return response.status(401).send({ message: "You haven't confirmed this account. Can't log in" });
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
});

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
