// utils/helpers/mailer.mjs

import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587, // Change port from 465 (SMTPS) to 587 (Submission)
  secure: false, // Set secure to false for port 587
  requireTLS: true, // Force TLS
  auth: {
    user: process.env.MAILER_USER,
    pass: process.env.MAILER_PASS, // Must be an App Password
  },
});

export const sendMail = async (recipient, subject, text, html) => {
  if (!process.env.MAILER_USER || !process.env.MAILER_PASS) {
    console.error(
      "FATAL: MAILER_USER or MAILER_PASS environment variables are missing."
    ); // Throw an error if config is missing to stop execution
    throw new Error("Email service configuration is incomplete.");
  }

  const mailOptions = {
    from: process.env.MAILER_USER,
    to: recipient,
    subject: subject,
    text: text,
    html: html,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log("Email sent successfully");
    return true; // Successfully sent
  } catch (error) {
    console.error("Error sending email:", error.message); // 🛑 CRITICAL FIX: Re-throw the error so it can be caught by the route handler's try/catch block
    throw new Error(`Nodemailer failed to send mail: ${error.message}`);
  }
};
