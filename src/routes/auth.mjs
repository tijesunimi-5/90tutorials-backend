import { Router } from "express";

const router = Router();
const registeredUsers = [];

router.get("/api/registered", (request, response) => {
  return response.status(200).send(registeredUsers);
})

export default router;