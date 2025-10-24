import jwt from "jsonwebtoken";

export const validateSession = (request, response, next) => {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return response.status(401).send({ message: "Authentication required." });
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { iat, exp, ...payload } = decoded;

    const newToken = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: "4h",
    });
    response.set("X-New-Token", `Bearer ${newToken}`);

    request.user = payload
    next()
  } catch (error) {
    return response.status(401).send({ message: "Invalid token." });
  }
};

export const validateSessio = (request, response, next) => {
  const token = request.headers.authorization?.split(" ")[1];
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
