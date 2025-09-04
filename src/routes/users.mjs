import { request, response, Router } from "express";
import { Data } from "../utils/data.mjs";
import {
  checkSchema,
  matchedData,
  query,
  validationResult,
} from "express-validator";
import { loginSchema, signUpSchema } from "../utils/userValidationSchema.mjs";
import { v4 as uuidv4 } from "uuid";
import nodemailer from "nodemailer";
import passport from "passport";

const router = Router();

//FUNCTION TO VALIDATE EMAIL ADDRESS
function validateEmail(email) {
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email);
}
//this variable holds all the users available in dummy data
const data = Data;
const resetTokens = {};
const confirmationCodes = {};
//configure nodemailer transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "tijesunimiidowu16@gmail.com",
    pass: "dcax dedk uigm pnzt",
  },
});

// ------------------- ROUTES ----------------------------------//

// this route gets all the users
router.get("/api/users", (request, response) => {
  // console.log(request.cookies);
  // if (request.cookies.hello && request.cookies.hello === "world")
  //   return response.send([{ data, statusbar: 200 }]);

  console.log(request.session.id);
  request.sessionStore.get(request.session.id, (err, sessionData) => {
    if (err) {
      console.log(err);
      throw err;
    }
    console.log(sessionData);
  });
  response.status(200).send(data);

  // return response.send({ msg: "Sorry, you need to obtain the correct cookie" });
});

//this route is to get specific user by name / email
router.get("/api/users/:identifier", (request, response) => {
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
router.post(
  "/api/users/signup",
  checkSchema(signUpSchema),
  (request, response) => {
    const result = validationResult(request); //this checks the whole request to make sure they meet up with the validation schema
    const validatedEmail = validateEmail(request.body.email); //this is to make sure the email is a valid one

    //this checks if error is available and email is invalid
    if (!result.isEmpty() || !validatedEmail)
      return response
        .status(400)
        .send({ errors: result.array(), message: "email is not valid" });

    //we get the validated body request in a variable
    const newdata = matchedData(request);

    //this checks if a user exists
    const existingUser = data.find((user) => user.email === newdata.email);
    if (existingUser) {
      return response.status(409).send({ message: "This user exists" });
    }

    //structing the correct information to have ID
    const newlyRegisteredUser = {
      id: data[data.length - 1].id + 1,
      confirmed: false,
      role: "student",
      ...newdata,
    };

    //pushing the new structed data to db
    data.push(newlyRegisteredUser);

    // Generate confirmation code and link
    const confirmationCode = uuidv4().slice(0, 8);
    confirmationCodes[confirmationCode] = {
      email: newdata.email,
      expires: Date.now() + 150000,
    };
    // const confirmationLink = `http:90-tutorials.vercel.app/student/auth?code=${confirmationCode}`;

    //send confirmation email
    const mailOptions = {
      from: "90-tutorials@gmail.com",
      to: newdata.email,
      subject: "Confirm Your Account",
      text: `Enter this code to confirm your account: ${confirmationCode}\nThis code expires in 1 minute 30 seconds.`,
      html: `<p>Enter this code to confirm your account: <strong>${confirmationCode}</strong> <br/>This link expires in 1 minute 30 seconds.</p>`,
    };

    transporter.sendMail(mailOptions, (error) => {
      if (error) {
        console.error("Error sending confirmation email:", error);
        return response.status(500).send({
          message:
            "Account created but confirmation email failed. Contact support.",
        });
      }
      response
        .status(201)
        .send({ message: "Account created. Check your email to confirm." });
    });

    // return response
    //   .status(201)
    //   .send({ "New users": newlyRegisteredUser, "All users": data });
  }
);

// this route is verify user
router.post("/api/users/confirm", (request, response) => {
  const { code } = request.body;
  if (!code || typeof code !== "string") {
    return response
      .status(400)
      .send({ message: "Invalid or expired confirmation code" });
  }

  console.log("Recieved code:", code);
  console.log("Stored codes:", confirmationCodes);
  const codeData = confirmationCodes[code];
  console.log(codeData);
  if (!codeData || codeData.expires < Date.now()) {
    return response.status(404).send({ message: "User not found" });
  }

  //Find and update the user with confirmed status
  const user = data.find((u) => u.email === codeData.email);
  if (!user) {
    return response.status(404).send({ message: "User not found" });
  }

  user.confirmed = true;
  delete confirmationCodes[code];
  console.log("User confirmed:", user);

  response.status(200).send({ message: "Confirmation code matched!" });
});

// this route is for logging in
router.post(
  "/api/users/login",
  // passport.authenticate("local"),
  checkSchema(loginSchema),
  (request, response) => {
    const result = validationResult(request);
    const validatedEmail = validateEmail(request.body.email);

    //this checks if error is available and email is invalid
    if (!result.isEmpty() || !validatedEmail)
      return response
        .status(400)
        .send({ errors: result.array(), message: "email is not valid" });

    const loggedUser = matchedData(request);
    const userExist = data.find((user) => user.email === loggedUser.email);

    if (userExist.password !== loggedUser.password) {
      return response.status(404).send({ message: "Password does not match" });
    }
    return response
      .status(200)
      .send({ message: "Log in successful", data: userExist });
  }
);

// ------ this route is for editing user --------- //
//this function lets us verify the id param to get a specific user
const resolveIndexByUserId = (request, response, next) => {
  const { id } = request.params;
  const parsedId = parseInt(id);

  if (isNaN(parsedId)) return response.sendStatus(400);
  const findUserIndex = data.findIndex((user) => user.id === parsedId);

  if (findUserIndex === -1) return response.sendStatus(404);
  request.findUserIndex = findUserIndex;
  next();
};
// the route to edit a user
router.patch("/api/users/:id", resolveIndexByUserId, (request, response) => {
  const { body } = request;
  const findUserIndex = request.findUserIndex;

  data[findUserIndex] = { ...data[findUserIndex], ...body };

  return response.sendStatus(200);
});

//------ this route is for forgot password -------- //
router.post("/api/users/forgot-password", async (request, response) => {
  const { email } = request.body;
  const validatedEmail = validateEmail(email);
  console.log(email);

  //validate email
  if (!validatedEmail) {
    return response.status(400).send({ Message: "Invalid email address." });
  }

  //Check if email exists
  const user = data.find(
    (u) => u.email && u.email.toLowerCase() === email.toLowerCase()
  );
  if (!user) {
    return response
      .status(404)
      .send({ message: "No user found with that email" });
  }

  //Generate a reset token
  const resetToken = uuidv4();
  const resetLink = `http://localhost:3000/api/users/reset-password?token=${resetToken}`;
  console.log(`Reset token for ${email}: ${resetToken}`);

  resetTokens[resetToken] = {
    email: email.toLowerCase(),
    expires: Date.now() + 3600000,
  };

  //Email options
  const mailOptions = {
    from: "90tutorials@gmail.com",
    to: email,
    subject: "Password Reset Request",
    text: `Click the following link to reset your password: ${resetLink}\nThis link will expire in 1 hour.`,
    html: `<p>Click <a href="${resetLink}">here</a> to reset your password. This link expires in an hour</p>`,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Reset link sent to ${email} with token: ${resetToken}`);
    return response.status(200).send({
      message:
        "If the email exists, a password reset linkhas been sent. Check your inbox.",
    });
  } catch (error) {
    console.error("Error sending email:", error);
    return response
      .status(500)
      .send({ message: "Failed to send reset email. Try again later." });
  }
});

// Reset password endpoint
router.post("/api/users/reset-password", (request, response) => {
  const { token, newPassword } = request.body;

  if (
    !token ||
    !newPassword ||
    typeof newPassword !== "string" ||
    newPassword.length < 6
  ) {
    return response.status(400).send({
      message:
        "Invalid token or password. Password must be at least 6 characters",
    });
  }

  const tokenData = resetTokens[token];
  if (!tokenData || tokenData.expires < Date.now()) {
    return response.status(400).send({ message: "Invalid or expired token." });
  }

  //Find and update the user
  const userIndex = data.findIndex(
    (u) => u.email && u.email.toLowerCase() === tokenData.email
  );
  if (userIndex === -1) {
    return response.status(404).send({ message: "User not found" });
  }

  data[userIndex].password = newPassword;
  delete resetTokens[token];

  return response.status(200).send({ message: "Password reset successful." });
});

// ---- Delete User ------ //
router.delete("/api/users/:id", async (request, response) => {
  const { id } = request.params;
  const parsedId = parseInt(id);

  if (isNaN(parsedId)) {
    return response
      .status(400)
      .send({ message: "Invalid ID. Must be a number." });
  }

  const userIndex = data.findIndex((user) => user.id === parsedId);
  if (userIndex === -1) {
    return response.status(404).send({ message: "User not found." });
  }

  data.splice(userIndex, 1);

  return response.status(204).send({ message: "Account deleted" });
});

export default router;

/*
• when handling a post request, we need this details
user email, name, password, subjects, role, signed in,

for url with queries to validate so, we need the query from express-validator
query('urlquery e.g filter).islenght()....
localhost:3000/90-tutorials.vercel.app/api/users?filter
*/


router.post('/api/auth', passport.authenticate('local'), (request, response) => {})