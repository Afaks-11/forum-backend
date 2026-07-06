import { asyncHandler } from "../middleware/asyncHandler.js";
import {
	blockUserAction,
	followUserAction,
	getUserCommentsByUsername,
	getUserPostsByUsername,
	getUserProfileByUsername,
	searchForUsers,
	unblockUserAction,
	unfollowUserAction,
} from "../services/user.service.js";
import {
	usernameParamSchema,
	userSearchSchema,
} from "../validators/user.validator.js";

export const getProfile = asyncHandler(async (req, res) => {
	const { username } = usernameParamSchema.parse(req.params);
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
