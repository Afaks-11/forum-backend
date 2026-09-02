import { asyncHandler } from "../middlewares/asyncHandler.js";
import {
	blockUserAction,
	followUserAction,
	getSavedComments,
	getSavedPosts,
	getUserCommentsByUsername,
	getUserPostsByUsername,
	getUserProfileByUsername,
	searchForUsers,
	unblockUserAction,
	unfollowUserAction,
} from "../services/user.service.js";
import {
	savedItemsQuerySchema,
	usernameParamSchema,
	userSearchSchema,
} from "../validators/user.validator.js";

export const getProfile = asyncHandler(async (req, res) => {
	const { username } = usernameParamSchema.parse(req.params);
	// This route is mounted behind optional auth, so the viewer may be anonymous;
	// the id is passed through only to resolve viewer-relative fields such as
	const currentUserId = res.locals.user?.userId;

	const data = await getUserProfileByUsername(username, currentUserId);
	res.status(200).json({ success: true, data });
});

export const getUserPosts = asyncHandler(async (req, res) => {
	const { username } = usernameParamSchema.parse(req.params);
	const data = await getUserPostsByUsername(username);
	res.status(200).json({ success: true, data });
});

export const getUserComments = asyncHandler(async (req, res) => {
	const { username } = usernameParamSchema.parse(req.params);
	const data = await getUserCommentsByUsername(username);
	res.status(200).json({ success: true, data });
});

export const followUser = asyncHandler(async (req, res) => {
	const { username } = usernameParamSchema.parse(req.params);
	await followUserAction(res.locals.user.userId, username);
	res
		.status(200)
		.json({ success: true, message: `Successfully followed @${username}` });
});

export const unfollowUser = asyncHandler(async (req, res) => {
	const { username } = usernameParamSchema.parse(req.params);
	await unfollowUserAction(res.locals.user.userId, username);
	res
		.status(200)
		.json({ success: true, message: `Successfully unfollowed @${username}` });
});

export const blockUser = asyncHandler(async (req, res) => {
	const { username } = usernameParamSchema.parse(req.params);
	await blockUserAction(res.locals.user.userId, username);
	res
		.status(200)
		.json({ success: true, message: `Successfully blocked @${username}` });
});

export const unblockUser = asyncHandler(async (req, res) => {
	const { username } = usernameParamSchema.parse(req.params);
	await unblockUserAction(res.locals.user.userId, username);
	res
		.status(200)
		.json({ success: true, message: `Successfully unblocked @${username}` });
});

export const handleUserSearch = asyncHandler(async (req, res) => {
	const parsedQuery = userSearchSchema.parse(req.query);
	const users = await searchForUsers(parsedQuery);
	res.status(200).json({
		success: true,
		data: users,
	});
});

export const getMySavedPosts = asyncHandler(async (req, res) => {
	const query = savedItemsQuerySchema.parse(req.query);
	const result = await getSavedPosts(res.locals.user.userId, query);
	res.status(200).json({
		success: true,
		data: result.items,
		meta: { nextCursor: result.nextCursor },
	});
});

export const getMySavedComments = asyncHandler(async (req, res) => {
	const query = savedItemsQuerySchema.parse(req.query);
	const result = await getSavedComments(res.locals.user.userId, query);
	res.status(200).json({
		success: true,
		data: result.items,
		meta: { nextCursor: result.nextCursor },
	});
});
