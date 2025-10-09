import { v4 as uuidv4 } from "uuid";

export function getConfirmationCode(email) {
  const otpCode = Math.floor(100000 + Math.random() * 900000); // this generates a 6-digit code
  const otpId = uuidv4(); //generates a unique id for the otp
  const expiresAt = new Date(Date.now() + 2 * 60 * 1000); // sets expiration date to 2 minutes
  const createdAt = new Date();
  console.log(otpId)

  return {
    otpId,
    email,
    otpCode,
    expiresAt,
    createdAt,
  };
}
