import { Router } from "express";
import userRouter from '../routes/users.mjs'
import examRouter from '../routes/examDocuments.mjs'

const router = Router()

router.use(userRouter)
router.use(examRouter)

export default router