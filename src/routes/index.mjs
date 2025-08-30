import { Router } from "express";
import userRouter from '../routes/users.mjs'
import authRouter from '../routes/auth.mjs'

const router = Router()

router.use(userRouter)
router.use(authRouter)

export default router