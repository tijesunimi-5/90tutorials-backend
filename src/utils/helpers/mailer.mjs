import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.MAILER_USER || "tijesunimiidowu16@gmail.com",
    pass: process.env.MAILER_PASS || "pqkagmzhxcrkwbho",
  },
});

export const sendMail = async (recipient, subject, text, html) => {
  console.log(process.env.MAILER_USER, process.env.MAILER_PASS);
  const mailOptions = {
    from: process.env.MAILER_USER,
    to: recipient,
    subject: subject,
    text: text,
    // html: html,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log("Email sent successfully");
    return true;
  } catch (error) {
    console.error("Error sending email:", error);
    return false;
  }
};

// export default sendMail;
