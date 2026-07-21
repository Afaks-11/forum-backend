import express from "express";
import {
	addCommunityModerator,
	browseCommunities,
	community,
	deleteCommunity,
	getCommunity,
	getCommunityMembers,
	getCommunityModerators,
	getCommunityPosts,
	handleCommunitySearch,
	inviteToCommunity,
	joinCommunity,
	leaveCommunity,
	patchAvatar,
	patchBanner,
	patchCommunity,
	patchRules,
	removeCommunityModerator,
} from "../controllers/community.controller.js";
import { requireAuth } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.get("/", browseCommunities);
router.get("/search", handleCommunitySearch);
router.get("/:slug", getCommunity);
router.get("/:slug/posts", getCommunityPosts);
router.get("/:slug/members", getCommunityMembers);
router.get("/:slug/moderators", getCommunityModerators);

router.post("/", requireAuth, community);
router.post("/:slug/join", requireAuth, joinCommunity);
router.post("/:slug/invite", requireAuth, inviteToCommunity);
router.post("/:id/moderators", requireAuth, addCommunityModerator);

router.patch("/:slug", requireAuth, patchCommunity);
router.patch("/:slug/rules", requireAuth, patchRules);
router.patch("/:slug/avatar", requireAuth, patchAvatar);
router.patch("/:slug/banner", requireAuth, patchBanner);

router.delete("/:slug/leave", requireAuth, leaveCommunity);
router.delete("/:slug", requireAuth, deleteCommunity);
router.delete("/:id/moderators/:userId", requireAuth, removeCommunityModerator);

export default router;
