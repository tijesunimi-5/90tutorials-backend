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


