import rateLimit from "express-rate-limit";

export const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window per IP
  message: { message: "Too many attempts, try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});
