import { Router } from "express";
import userRouter from '../routes/user/users.mjs'
import examRouter from '../routes/exams/examDocuments.mjs'
import adminUserRouter from "../routes/admin/adminUser.mjs"
import authorizeStudentRouter from '../routes/authorize/index.mjs'
import resultRouter from "../routes/result/index.mjs"

const router = Router()

router.use(userRouter)
router.use(examRouter)
router.use(adminUserRouter)
router.use(authorizeStudentRouter)
router.use(resultRouter)

export default router