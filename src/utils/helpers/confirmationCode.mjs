import { v4 as uuidv4 } from "uuid";

export function getConfirmationCode(email) {
  const otpCode = Math.floor(100000 + Math.random() * 900000); 
  const otpId = uuidv4(); 
  const expiresAt = new Date(Date.now() + 2 * 60 * 1000); 
  const createdAt = new Date();

  return {
    otpId,
    email,
    otpCode,
    expiresAt,
    createdAt,
  };
}
