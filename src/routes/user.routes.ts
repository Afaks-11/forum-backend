import express from "express";
import {
	blockUser,
	followUser,
	getMySavedComments,
	getMySavedPosts,
	getProfile,
	getUserComments,
	getUserPosts,
	handleUserSearch,
	unblockUser,
	unfollowUser,
} from "../controllers/user.controller.js";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { optionalAuth } from "../middlewares/optionalAuth.middleware.js";

const router = express.Router();

router.get("/search", handleUserSearch);
// Literal `/me` routes must precede `/:username`, otherwise Express treats
// `me` as a public username and never reaches these authenticated resources.
router.get("/me/saved/posts", requireAuth, getMySavedPosts);
router.get("/me/saved/comments", requireAuth, getMySavedComments);
router.get("/:username", optionalAuth, getProfile);
router.get("/:username/posts", getUserPosts);
router.get("/:username/comments", getUserComments);

router.post("/:username/follow", requireAuth, followUser);
router.delete("/:username/unfollow", requireAuth, unfollowUser);

router.post("/:username/block", requireAuth, blockUser);
router.delete("/:username/unblock", requireAuth, unblockUser);

export default router;
