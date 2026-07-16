import type { Request, Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import {
	assignModeratorRole,
	createCommunity,
	deleteCommunityAction,
	getAllCommunitiesList,
	getCommunityDetails,
	getCommunityPostsFeed,
	getGroupRoster,
	inviteUserToCommunitySpace,
	joinCommunityAction,
	leaveCommunityAction,
	revokeModeratorRole,
	searchForCommunities,
	updateCommunityFields,
	updateCommunityMediaAsset,
	updateCommunityRulesText,
} from "../services/community.service.js";
import {
	addModeratorSchema,
	communityIdParamSchema,
	communitySearchSchema,
	createCommunitySchema,
	inviteToCommunitySchema,
	removeModeratorParamSchema,
	slugParamSchema,
	updateAvatarSchema,
	updateBannerSchema,
	updateCommunitySchema,
	updateRulesSchema,
} from "../validators/community.validator.js";

export const community = asyncHandler(async (req: Request, res: Response) => {
	const userId = res.locals.user.userId;
	const validatedData = createCommunitySchema.parse(req.body);

	const newCommunity = await createCommunity(validatedData, userId);

	res.status(201).json({
		success: true,
		data: newCommunity,
	});
});

export const browseCommunities = asyncHandler(async (_req, res) => {
	const data = await getAllCommunitiesList();
	res.status(200).json({ success: true, data });
});

export const getCommunity = asyncHandler(async (req, res) => {
	const { slug } = slugParamSchema.parse(req.params);
	const data = await getCommunityDetails(slug);
	res.status(200).json({ success: true, data });
});

export const joinCommunity = asyncHandler(async (req, res) => {
	const { slug } = slugParamSchema.parse(req.params);
	await joinCommunityAction(res.locals.user.userId, slug);
	res.status(200).json({ success: true, message: "Joined successfully" });
});

export const leaveCommunity = asyncHandler(async (req, res) => {
	const { slug } = slugParamSchema.parse(req.params);
	await leaveCommunityAction(res.locals.user.userId, slug);
	res.status(200).json({ success: true, message: "Left successfully" });
});

export const getCommunityPosts = asyncHandler(async (req, res) => {
	const { slug } = slugParamSchema.parse(req.params);
	const data = await getCommunityPostsFeed(slug);
	res.status(200).json({ success: true, data });
});

export const getCommunityMembers = asyncHandler(async (req, res) => {
	const { slug } = slugParamSchema.parse(req.params);
	const data = await getGroupRoster(slug, "MEMBER");
	res.status(200).json({ success: true, data });
});

export const getCommunityModerators = asyncHandler(async (req, res) => {
	const { slug } = slugParamSchema.parse(req.params);
	const data = await getGroupRoster(slug, "MODERATOR");
	res.status(200).json({ success: true, data });
});

export const patchCommunity = asyncHandler(async (req, res) => {
	const { slug } = slugParamSchema.parse(req.params);
	const { description } = updateCommunitySchema.parse(req.body);
	const data = await updateCommunityFields(
		slug,
		res.locals.user.userId,
		description,
	);
	res.status(200).json({ success: true, data });
});

export const patchRules = asyncHandler(async (req, res) => {
	const { slug } = slugParamSchema.parse(req.params);
	const { rules } = updateRulesSchema.parse(req.body);
	const data = await updateCommunityRulesText(
		slug,
		res.locals.user.userId,
		rules,
	);
	res.status(200).json({ success: true, data });
});

export const patchAvatar = asyncHandler(async (req, res) => {
	const { slug } = slugParamSchema.parse(req.params);
	const { avatarUrl } = updateAvatarSchema.parse(req.body);
	const data = await updateCommunityMediaAsset(
		slug,
		res.locals.user.userId,
		"avatar",
		avatarUrl,
	);
	res.status(200).json({ success: true, data });
});

export const patchBanner = asyncHandler(async (req, res) => {
	const { slug } = slugParamSchema.parse(req.params);
	const { bannerUrl } = updateBannerSchema.parse(req.body);
	const data = await updateCommunityMediaAsset(
		slug,
		res.locals.user.userId,
		"banner",
		bannerUrl,
	);
	res.status(200).json({ success: true, data });
});

export const deleteCommunity = asyncHandler(async (req, res) => {
	const { slug } = slugParamSchema.parse(req.params);
	await deleteCommunityAction(slug, res.locals.user.userId);
	res.status(204).end();
});

export const inviteToCommunity = asyncHandler(
	async (req: Request, res: Response) => {
		const { slug } = slugParamSchema.parse(req.params);
		const { targetUsername } = inviteToCommunitySchema.parse(req.body);
		const senderId = res.locals.user.userId;

		await inviteUserToCommunitySpace(slug, targetUsername, senderId);

		res.status(200).json({
			success: true,
			message: `Invitation successfully dispatched to @${targetUsername}`,
		});
	},
);

export const addCommunityModerator = asyncHandler(async (req, res) => {
	const { id } = communityIdParamSchema.parse(req.params);
	const { userId } = addModeratorSchema.parse(req.body);
	const currentUserId = res.locals.user.userId; // Required to check if executing user is a moderator

	await assignModeratorRole(id, userId, currentUserId);

	res.status(200).json({
		success: true,
		message: "Target user successfully granted community moderator privileges.",
	});
});

export const removeCommunityModerator = asyncHandler(async (req, res) => {
	const { id, userId } = removeModeratorParamSchema.parse(req.params);
	const currentUserId = res.locals.user.userId; // Required to check if executing user is a moderator

	await revokeModeratorRole(id, userId, currentUserId);

	res.status(200).json({
		success: true,
		message:
			"Target user successfully removed from the community moderator panel.",
	});
});

export const handleCommunitySearch = asyncHandler(async (req, res) => {
	const parsed = communitySearchSchema.parse(req.query);
	const communities = await searchForCommunities(parsed);

	res.status(200).json({
		success: true,
		data: communities,
	});
});
