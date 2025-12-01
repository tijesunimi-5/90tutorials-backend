import jwt from "jsonwebtoken";

// ---------------- VALIDATE SESSION (FIXED) ---------------- //
export async function validateSession(req, res, next) {
  try {
    let token;

    // Accept both Authorization header and cookie
    if (req.headers.authorization?.startsWith("Bearer ")) {
      token = req.headers.authorization.split(" ")[1];
    } else if (req.cookies?.token) {
      token = req.cookies.token;
    }

    if (!token) {
      return res.status(401).json({ message: "No token provided" });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 🟢 CRITICAL FIX: Ensure the email is extracted from the JWT payload
    // and attached to the request object for use in subsequent routes (like /results/submit).
    if (!decoded.email) {
      return res
        .status(401)
        .json({ message: "Invalid token payload: Email missing." });
    }

    req.user = {
      userId: decoded.userId,
      email: decoded.email, // ⬅️ ADDED THIS LINE
      role: decoded.role,
    };

    next();
  } catch (error) {
    console.error("Session validation failed:", error);

    return res.status(401).json({
      message: "Session expired or invalid. Please log in again.",
    });
  }
}
