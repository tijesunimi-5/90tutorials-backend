// import nodemailer from "nodemailer";

// const transporter = nodemailer.createTransport({
//   host: "smtp.gmail.com",
//   port: 587,
//   secure: false,
//   auth: {
//     user: process.env.MAILER_USER,
//     pass: process.env.MAILER_PASS
//   },
//   tls: {
//     rejectUnauthorized: false,
//   },
// });

// export const sendMail = async (recipient, subject, text, html) => {
//   console.log(process.env.MAILER_USER, process.env.MAILER_PASS);
//   const mailOptions = {
//     from: process.env.MAILER_USER,
//     to: recipient,
//     subject: subject,
//     text: text,
//     html: html,
//   };

//   try {
//     await transporter.sendMail(mailOptions);
//     console.log("Email sent successfully");
//     return true;
//   } catch (error) {
//     console.error("Error sending email:", error);
//     return false;
//   }
// };

// // export default sendMail;

import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export const sendMail = async (recipient, subject, text, html) => {
  try {
    const response = await resend.emails.send({
      from: "no-reply@react-email.live", // FREE sender, no domain needed
      to: recipient,
      subject: subject,
      text: text,
      html: html,
    });

    console.log("Email sent successfully:", response);
    return true;
  } catch (error) {
    console.error("Error sending email:", error);
    return false;
  }
};
