import nodemailer from "nodemailer";

//configure nodemailer transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "tijesunimiidowu16@gmail.com",
    pass: "dcax dedk uigm pnzt",
  },
});

export const sendMail = (recipient, mailSubject, mailText, mailHtml) => {
  const mailOptions = {
    from: process.env.TUTORIAL_MAIL,
    to: recipient,
    subject: mailSubject,
    text: mailText,
    html: mailHtml,
  };

  transporter.sendMail(mailOptions, (error) => {
    if (error) {
      console.error("Error sending mail:", error);
      return { err: "Couldn't send mail. Try again later!" };
    }
    return { err: "Mail has been sent, check your email to confirm." };
  });
};

// const confirmationLink = `http:90-tutorials.vercel.app/student/auth?code=${confirmationCode}`;

//send confirmation email
// const mailOptions = {
//   from: "90-tutorials@gmail.com",
//   to: newdata.email,
//   subject: "Confirm Your Account",
//   text: `Enter this code to confirm your account: ${confirmationCode}\nThis code expires in 1 minute 30 seconds.`,
//   html: `<p>Enter this code to confirm your account: <strong>${confirmationCode}</strong> <br/>This link expires in 1 minute 30 seconds.</p>`,
// };

// transporter.sendMail(mailOptions, (error) => {
//   if (error) {
//     console.error("Error sending confirmation email:", error);
//     return response.status(500).send({
//       message:
//         "Account created but confirmation email failed. Contact support.",
//     });
//   }
//   response
//     .status(201)
//     .send({ message: "Account created. Check your email to confirm." });
// });
