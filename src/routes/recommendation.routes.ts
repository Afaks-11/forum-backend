import { Router } from "express";
import {
	handleGetCommunityRecommendations,
	handleGetPostRecommendations,
} from "../controllers/recommendation.controller.js";
import { optionalAuth } from "../middlewares/optionalAuth.middleware.js";

const router = Router();

router.get("/communities", optionalAuth, handleGetCommunityRecommendations);
router.get("/posts", optionalAuth, handleGetPostRecommendations);

export default router;
