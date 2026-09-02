import express from "express";
import { listReports, patchReport } from "../controllers/report.controller.js";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { requireAdmin } from "../middlewares/role.middleware.js";

const router = express.Router();

router.use(requireAuth, requireAdmin);
router.get("/", listReports);
router.patch("/:id", patchReport);

export default router;
