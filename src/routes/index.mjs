import { Router } from "express";
import userRouter from "./user/users.mjs";
import examRouter from "./exams/examDocuments.mjs";
import adminUserRouter from "./admin/adminUser.mjs";
import authorizeStudentRouter from "./authorize/index.mjs";
import resultRouter from "./result/index.mjs";
import reviewRouter from "./review/index.mjs";

const router = Router();

// NOTE: We mount the routers at their expected base paths.
// Frontend calls should be structured as /user/login, /exam/all-exams, /results/exams, etc.

// 1. User routes (Login, Signup, Verify, etc.) - Often mounted at the root / or /user
router.use(userRouter);

// 2. Exam Document (Catalog) routes - Frontend calls e.g., /exam/all-exams, /exam/categories
router.use(examRouter);

// 3. Admin User Management routes
router.use( adminUserRouter);

// 4. Authorization routes (Admin actions like revoking access, changing ID prefix)
router.use( authorizeStudentRouter);

// 5. Result routes (Student attempts, Admin summaries)
router.use( resultRouter);

// 6. Review/Feedback routes (Admin view)
router.use( reviewRouter);

// NOTE on ReviewRouter: If the frontend calls /reviews/all (for example), this is correct.
// If the frontend calls /results/reviews (as used before), you should use: router.use('/results', reviewRouter)

// Based on the frontend's explicit use of '/exam/all-exams' and '/results/reviews',
// the two most likely missing prefixes were '/exam' and potentially '/results' for reviews.

export default router;
