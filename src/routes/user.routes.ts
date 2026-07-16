import express from "express";
import {
	blockUser,
	followUser,
	getProfile,
	getUserComments,
	getUserPosts,
	handleUserSearch,
	unblockUser,
	unfollowUser,
} from "../controllers/user.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { optionalAuth } from "../middleware/optionalAuth.middleware.js";

const router = express.Router();

router.get("/search", handleUserSearch);
router.get("/:username", optionalAuth, getProfile);
router.get("/:username/posts", getUserPosts);
router.get("/:username/comments", getUserComments);

router.post("/:username/follow", requireAuth, followUser);
router.delete("/:username/unfollow", requireAuth, unfollowUser);

router.post("/:username/block", requireAuth, blockUser);
router.delete("/:username/unblock", requireAuth, unblockUser);

export default router;
