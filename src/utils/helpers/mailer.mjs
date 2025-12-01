// utils/helpers/mailer.mjs

import { Resend } from "resend";

// Initialize Resend using the environment variable
const resend = new Resend(process.env.RESEND_API_KEY);

export const sendMail = async (recipient, subject, text, html) => {
  // Use the verified sender email from your Render environment
  const senderEmail = process.env.MAILER_SENDER_EMAIL;
  if (!senderEmail || !process.env.RESEND_API_KEY) {
    console.error("FATAL: Resend configuration is incomplete."); // Throw to stop the /user/signup transaction
    throw new Error("Email service not configured.");
  }

  try {
    const { data, error } = await resend.emails.send({
      from: senderEmail, // Must be a verified sender in Resend
      to: recipient,
      subject: subject,
      text: text,
      html: html,
    });

    if (error) {
      throw new Error(`Resend API Error: ${error.message}`);
    }

    console.log("Email sent successfully via Resend API. ID:", data.id);
    return true;
  } catch (error) {
    console.error("Error sending email via Resend:", error.message); // Throw the error so your /user/signup route stops the DB transaction
    throw new Error(`Email sending failed: ${error.message}`);
  }
};
