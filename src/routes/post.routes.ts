import express from "express";
import { handleGetFeed } from "../controllers/feed.controller.js";
import {
	create,
	getActivePosts,
	getPost,
	getVotesData,
	handlePostSearch,
	patchPost,
	removePost,
	savePost,
	toggleModerationFlag,
	unsavePost,
} from "../controllers/post.controller.js";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { optionalAuth } from "../middlewares/optionalAuth.middleware.js"; // Standard fallback utility if available
import { requireModerator } from "../middlewares/role.middleware.js";

const router = express.Router();

router.get("/", getActivePosts);
router.get("/search", handlePostSearch);
router.get("/:id", getPost);
router.get("/feed", handleGetFeed);

router.post("/", requireAuth, create);
router.patch("/:id", requireAuth, patchPost);
router.delete("/:id", requireAuth, removePost);

router.get("/posts/:id/votes", optionalAuth, getVotesData);
router.post("/:id/save", requireAuth, savePost);
router.delete("/:id/save", requireAuth, unsavePost);

router.post(
	"/:id/pin",
	requireAuth,
	requireModerator,
	toggleModerationFlag("PIN"),
);
router.post("/:id/lock", requireAuth, toggleModerationFlag("LOCK"));
router.post("/:id/hide", requireAuth, toggleModerationFlag("HIDE"));
router.post("/:id/report", requireAuth, toggleModerationFlag("REPORT"));

export default router;
