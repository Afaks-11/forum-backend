import express from "express";
import { voteCasting } from "../controllers/vote.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = express.Router();

router.post("/", requireAuth, voteCasting);

export default router;
