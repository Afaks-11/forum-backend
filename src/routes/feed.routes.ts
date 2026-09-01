import express from "express";
import { handleGetFeed } from "../controllers/feed.controller.js";
import { optionalAuth } from "../middlewares/optionalAuth.middleware.js";

const router = express.Router();

// `optionalAuth` matches the sibling `GET /posts`: a token, when present, lets
// each row carry the caller's own vote, but anonymous reads stay open.
router.get("/", optionalAuth, handleGetFeed);

export default router;
