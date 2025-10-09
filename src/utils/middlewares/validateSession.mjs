import jwt from "jsonwebtoken";

export const validateSession = (request, response, next) => {
  const token = request.headers.authorization?.split("")[1];
  if (!token)
    return response.status(401).send({ message: "Authentications required." });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    request.user = decoded;
    next();
  } catch (error) {
    return response.status(401).send({ message: "Invalid or expired token." });
  }
};
