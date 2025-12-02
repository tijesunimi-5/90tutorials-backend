import { Router } from "express";
import userRouter from "./user/users.mjs";
import examRouter from "./exams/examDocuments.mjs"
import adminUserRouter from "./admin/adminUser.mjs";
import authorizeStudentRouter from "./authorize/index.mjs";
import resultRouter from "./result/index.mjs";
import reviewRouter from "./review/index.mjs";

const router = Router();


router.use(userRouter);

router.use("/exam", examRouter);

router.use( adminUserRouter);

router.use( authorizeStudentRouter);

router.use( resultRouter);

router.use( reviewRouter);



export default router;
