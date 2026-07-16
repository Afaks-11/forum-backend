import { Router } from "express";
import {
	handleGetCommunityRecommendations,
	handleGetPostRecommendations,
} from "../controllers/recommendation.controller.js";

const router = Router();

router.get("/communities", handleGetCommunityRecommendations);
router.get("/posts", handleGetPostRecommendations);

export default router;
