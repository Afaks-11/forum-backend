import express from "express";
import { voteCasting } from "../controllers/vote.controller.js";
import { requireAuth } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.post("/", requireAuth, voteCasting);

export default router;
