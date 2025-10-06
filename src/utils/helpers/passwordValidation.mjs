import bcrypt from "bcrypt";

const saltRounds = 10;

export const hashPassword = async (password) => {
  const salt = await bcrypt.genSalt(saltRounds);
  console.log(salt);
  return await bcrypt.hash(password, salt);
};

export const comparePassword = async (plain, hashed) => {
  return await bcrypt.compare(plain, hashed);
};

export const passwordValidator = (password) => {
  const errors = [];
  const requirements = {
    minLength: password.length >= 8,
    maxLength: password.length <= 24,
    hasUppercase: /[A-Z]/.test(password),
    hasLowercase: /[a-z]/.test(password),
    hasNumber: /\d/.test(password),
    hasSpecialChar: /[@$!%*?&_-]/.test(password),
  };

  if (!requirements.minLength)
    errors.push("Password must be at least 8 characters long");
  if (!requirements.maxLength)
    errors.push("Password must be no more than 24 characters long");
  if (!requirements.hasUppercase)
    errors.push("Password must at least one uppercase letter");
  if (!requirements.hasLowercase)
    errors.push("Password must at least one lowercase letter");
  if (!requirements.hasNumber) errors.push("Password must at least one number");
  if (!requirements.hasSpecialChar)
    errors.push("Password must at least one special character");

  if (errors.length > 0) return { valid: false, errors };

  return { valid: true };
};

export const secretValidator = (secret) => {
  const errors = [];
  const requirements = {
    length: secret.length === 6,
    hasNumber: /^\d+$/.test(secret),
  };

  if (!requirements.length) errors.push("Password must be 6 numbers long");
  if (!requirements.hasNumber) errors.push("Password must be a number");

  if (errors.length > 0) return { valid: false, errors };

  return { valid: true };
};
