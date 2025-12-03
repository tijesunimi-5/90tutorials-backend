import { Router } from "express";
import { checkSchema, matchedData, validationResult } from "express-validator";
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
import { rateLimiter } from "../../utils/middlewares/rateLimiter.mjs";
import bcrypt from "bcrypt";
import { fetchAllAuthorizedExamsData } from "../../utils/helpers/helper.mjs";

const router = Router();

const buildUserFeedback = (user) => ({
  userID: user.id,
  name: user.user.name,
  email: user.user.email,
  role: user.user.role,
  confirmed: user.user.confirmed,
  logged: user.user.logged,
  createdAt: user.user.created_at,
});

// ------------------- ROUTES ----------------------------------//

// this route gets all the users
router.get("/users", validateSession, async (request, response) => {
  const { query } = request.query;
  let fetch_query = `
		SELECT
			u.id, u.name, u.email, u.role, u.confirmed, u.created_at,
			COALESCE(
				json_agg(
					json_build_object(
						'exam_auth_id', sa.exam_auth_id,
						'exam_title', ea.exam_title
					)
				) FILTER (WHERE sa.id IS NOT NULL),
				'[]'::json
			) AS authorized_exams
		FROM users u
		LEFT JOIN students_authorized sa ON u.email = sa.email
		LEFT JOIN exams_authorized ea ON sa.exam_auth_id = ea.id
	`;
  const queryParams = [];

  if (query) {
    // Use ILIKE for case-insensitive search on name or email
    fetch_query += ` WHERE u.name ILIKE $1 OR u.email ILIKE $1`;
    queryParams.push(`%${query}%`);
  }

  fetch_query += ` GROUP BY u.id ORDER BY u.created_at DESC`;

  try {
    const result = await pool.query(fetch_query, queryParams);

    // Fetch the list of all authorized exam IDs and titles
    const allExams = await fetchAllAuthorizedExamsData();

    const usersWithAuthStatus = result.rows.map((user) => {
      // Change column name from 'authorized_exams_ids' to 'authorized_exams' in the query
      // This extracts the ID and the Title
      const authorizedExams = user.authorized_exams.map((auth) => ({
        id: auth.exam_auth_id,
        title: auth.exam_title, // <-- Now available
      }));
      return {
        ...user,
        // The list now contains objects { id: number, title: string }
        authorized_exams: authorizedExams,
        // Remove the complex JSON aggregation column
        authorized_exams_ids: undefined, // Assuming you still want to clear the old column name
      };
    });

    return response.status(200).send({
      message: "Successfully fetched users and authorization data",
      data: {
        users: usersWithAuthStatus,
        all_authorized_exams: allExams,
      },
    });
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
    const validatedPassword = passwordValidator(password); // Your SQL queries (as they were)
    const insert_query =
      "INSERT INTO users (id, name, email, password_hashed, confirmed, role, is_logged_id, secret) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)";
    const filter_query = "SELECT email FROM users WHERE email = $1";
    const insert_confirmation_query =
      "INSERT INTO confirmation_tokens (id, user_id, otp, email_to_confirm, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6)";
    const emailExists = await pool.query(filter_query, [email]);

    try {
      // 1. Pre-Database Validations
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
      newRequest.password = await hashPassword(password); // 2. Generate OTP confirmation code and setup mail content

      const cc = getConfirmationCode(newRequest.email);
      const userid = generateID(9);
      const subject = "Welcome! Confirm your account";
      const text = `Enter this code to confirm your account: ${cc.otpCode}. This code expires in 2 minutes.`;
      const html = `<p>Enter this code to confirm your account: <strong>${cc.otpCode}</strong></p><p>This code expires in 2 minutes.</p>`; // 🛑 CRITICAL FIX: Attempt to send the mail FIRST. // If this fails, it will throw an error and jump to the catch block, // preventing the account from being saved without a sent OTP.

      // await sendMail(email, subject, text, html); // Note: Since sendMail now THROWS on failure, we don't need the `if (!mailSent)` check here. // 3. Build User Object (happens after successful email send)
      const newUser = {
        id: userid,
        user: {
          ...newRequest,
          confirmed: true,
          role: "Student",
          logged: true,
        }, // ... (rest of your newUser object)
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
        confirmed: true,
        logged: true,
      }; // 4. 💾 Database Inserts (happen ONLY if email send was successful)

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
      ]); // 5. ✅ Final success response to the client

      return response.status(201).send({
        message: "Account created. Check your mail to confirm.",
        user: buildUserFeedback(newUser), // You may want to add a redirect flag if your frontend uses it
        // redirect: "/confirm-otp",
      });
    } catch (error) {
      // This catches validation errors, DB errors, and now, email sending errors.
      console.error("Signup Error:", error.message || error); // Send a generic 500 status back to the client
      return response.status(500).send({
        message: `A server error occurred during account creation: ${error.message}`,
      });
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
        email: email,
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

router.post("/resend-otp", async (request, response) => {
  const { email } = request.body;
  const fetch_user_query = "SELECT id FROM users WHERE email = $1"; // Optimized to fetch only id
  const existing_confirmation_query =
    "SELECT resend_count, expires_at FROM confirmation_tokens WHERE user_id = $1";

  const OTP_RESEND_LIMIT = 3;
  const OTP_COOLDOWN_MINUTES = 5;

  try {
    const user = await pool.query(fetch_user_query, [email]);
    if (user.rows.length === 0) {
      // Check if user exists
      return response.status(404).send({ message: "User not found" });
    }
    const userId = user.rows[0].id;

    const existing_confirmed_user = await pool.query(
      existing_confirmation_query,
      [userId]
    );
    const existing_token = existing_confirmed_user.rows[0];

    let newResendCount = 1; // Default to 1 for a new token
    let shouldSendEmail = true;

    if (existing_token) {
      // Check if the user has hit the resend limit
      if (existing_token.resend_count >= OTP_RESEND_LIMIT) {
        const cooldownTime = new Date(
          existing_token.expires_at.getTime() + OTP_COOLDOWN_MINUTES * 60 * 1000
        );

        if (new Date() < cooldownTime) {
          // Still in cooldown period
          const waitMinutes = Math.ceil(
            (cooldownTime - new Date()) / (60 * 1000)
          );
          return response.status(429).send({
            message: `Too many resend attempts. Please wait ${waitMinutes} minutes.`,
          });
        } else {
          // Cooldown has expired, so we can reset the resend count.
          newResendCount = 1;
        }
      } else {
        // Increment the resend count for a new attempt.
        newResendCount = existing_token.resend_count + 1;
      }
    }

    // Generate new OTP and update/insert logic
    const newOTP = getConfirmationCode(email);
    if (existing_token) {
      await pool.query(
        "UPDATE confirmation_tokens SET otp = $1, resend_count = $2, created_at = $3, expires_at = $4 WHERE user_id = $5",
        [
          newOTP.otpCode,
          newResendCount,
          newOTP.createdAt,
          newOTP.expiresAt,
          userId,
        ]
      );
    } else {
      // 🚀 FIX: Must include 'id' and pass newOTP.otpId as the first parameter
      await pool.query(
        "INSERT INTO confirmation_tokens (id, user_id, otp, email_to_confirm, resend_count, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [
          newOTP.otpId, // $1: The missing ID causing the NOT NULL violation
          userId, // $2
          newOTP.otpCode, // $3
          newOTP.email, // $4
          newResendCount, // $5
          newOTP.createdAt, // $6
          newOTP.expiresAt, // $7
        ]
      );
    }

    // Send the email
    // await sendMail(
    //   email,
    //   "Your New OTP",
    //   `Your new OTP is: ${newOTP.otpCode}`,
    //   `Your new OTP is: <b>${newOTP.otpCode}</b>`
    // );

    return response.status(200).send({ message: "New OTP sent successfully" });
  } catch (error) {
    console.error("From resend-otp, an error occured", error);
    return response.status(500).send({ error: `An error occured ${error}` });
  }
});

// this route is for logging in
router.post("/user/login", checkSchema(loginSchema), async (req, res) => {
  const { email, password } = req.body;
  const result = validationResult(req);

  try {
    // Basic validation (email format)
    if (!result.isEmpty() || !emailValidator(email)) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    // Fetch user
    const userQuery = "SELECT * FROM users WHERE email = $1";
    const userResult = await pool.query(userQuery, [email]);
    const user = userResult.rows[0];

    if (!user) {
      return res.status(404).json({ message: "User does not exist" });
    }

    // Compare password
    const validPass = await comparePassword(password, user.password_hashed);
    if (!validPass) {
      return res.status(400).json({ message: "Password is incorrect" });
    }

    // Mark user logged in
    await pool.query("UPDATE users SET is_logged_id = TRUE WHERE email = $1", [
      email,
    ]);

    // Generate JWT
    const token = jwt.sign(
      { userId: user.id, role: user.role, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "4h" }
    );

    const cleanedUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      confirmed: user.confirmed,
      logged: true,
      createdAt: user.created_at,
    };

    return res.status(200).json({
      message: "Login successful",
      user: cleanedUser,
      token,
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// POST /verify-secret - Secure Admin Login
router.post("/verify-secret", rateLimiter, async (req, res) => {
  console.log("--------You just hit the verify route ------");
  const { email, secret } = req.body;

  // Input validation
  if (!email || !secret) {
    return res.status(400).json({
      message: "Email and secret are required",
    });
  }

  try {
    // Fetch only needed fields + hashed secret
    const result = await pool.query(
      `SELECT id, name, email, role, secret FROM users WHERE email = $1 AND role = 'Admin'`,
      [email]
    );

    const admin = result.rows[0];

    if (!admin) {
      // Don't reveal if email exists or not
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Compare hashed secret (using bcrypt)
    const isValid = await bcrypt.compare(secret, admin.secret);
    if (!isValid) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Generate JWT
    const token = jwt.sign(
      { userId: admin.id, role: admin.role },
      process.env.JWT_SECRET,
      { expiresIn: "4h" }
    );

    // Remove sensitive fields before sending
    const { secret_hash, ...safeAdmin } = admin;

    // Send token + minimal user data
    return res.status(200).json({
      message: "Welcome, Boss! Respect o",
      token, // ← THIS WAS MISSING!
      user: safeAdmin,
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/verify-session", validateSession, async (request, response) => {
  try {
    // ⬇️ FIX APPLIED: Cleaned up the spacing between the table alias 'u' and 'WHERE'
    const userQueryText = `SELECT u.id, u.name, u.email, u.role FROM "users" u WHERE u."id" = $1`;

    const result = await pool.query(userQueryText, [request.user.userId]);
    if (result.rows.length === 0) {
      return response.status(404).send({ message: "User not found." });
    }
    response.status(200).send({
      message: "Session is valid.",
      user: result.rows[0],
    });
  } catch (error) {
    console.error("Session check failed:", error);
    return response.status(500).send({ message: "Server error" });
  }
});

router.patch("/edit", validateSession, async (request, response) => {
  const { email, name } = request.body;
  const fetch_user_query = "SELECT * FROM users WHERE email = $1";
  const user = (await pool.query(fetch_user_query, [email])).rows[0];

  if (!user) {
    return response.status(404).send({ message: "User not found" });
  }

  if (!name) {
    return response
      .status(400)
      .send({ message: "Name field cannot be left empty" });
  }

  await pool.query("UPDATE users SET name = $1 WHERE email = $2", [
    name,
    email,
  ]);

  const newUser = await pool.query("SELECT name FROM users WHERE email = $1", [
    email,
  ]);
  return response
    .status(200)
    .send({ message: "Name has been changed", username: newUser });
});

router.patch("/reset-password", async (request, response) => {
  const { password, email } = request.body;
  const fetch_user_query = "SELECT * FROM users WHERE email = $1";
  const validatedPassword = passwordValidator(password);
  const user = (await pool.query(fetch_user_query, [email])).rows[0];

  try {
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
    await pool.query("UPDATE users SET password_hashed = $1 WHERE email = $2", [
      hashedPassword,
      email,
    ]);

    return response.status(200).send({ message: "Password has been changed" });
  } catch (error) {
    console.error("An error occured:", error);
    return response
      .status(500)
      .send({ message: "An error occured", error: error });
  }
});

export default router;
