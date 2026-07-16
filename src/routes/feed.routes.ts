import express from "express";
import { handleGetFeed } from "../controllers/feed.controller.js";

const router = express.Router();

router.get("/", handleGetFeed);

export default router;
