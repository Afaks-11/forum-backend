import express from "express";
import { getUploadSignature } from "../controllers/upload.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = express.Router();

router.get("/signature", requireAuth, getUploadSignature);

export default router;
