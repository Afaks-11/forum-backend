import { AppError } from "../errors/AppError.js";
import { userRepository } from "../repositories/index.js";
import { redis } from "../utils/redis.js";
import type { UserSearchInput } from "../validators/user.validator.js";

type UserProfilePayload = Awaited<
	ReturnType<typeof userRepository.findProfileWithCounters>
> & {
	isFollowing: boolean;
};
type UserPostsPayload = Awaited<
	ReturnType<typeof userRepository.findPostsByAuthorId>
>;
type UserCommentsPayload = Awaited<
	ReturnType<typeof userRepository.findCommentsByAuthorId>
>;

const getTargetUser = async (username: string) => {
	const target = await userRepository.findByUsername(username);
	if (!target) throw new AppError("Target user not found", 404);
	return target;
};

export const getUserProfileByUsername = async (
	username: string,
	currentUserId?: string,
) => {
	const viewerKey = currentUserId;
	const cacheKey = `profile:username:${username}:viewer:${viewerKey}`;
	const cachedDurationSeconds = 3600;

	const cachedProfile = await redis.get<UserProfilePayload>(cacheKey);
	if (cachedProfile) return cachedProfile;

	const targetUser = await getTargetUser(username);

	if (currentUserId) {
		const isBlocked = await userRepository.checkBlockRelation(
			currentUserId,
			targetUser.id,
		);
		if (isBlocked) throw new AppError("Profile unavailable", 404); // Obliterate profile access silently for safety
	}

	const profile = await userRepository.findProfileWithCounters(targetUser.id);
	if (!profile) {
		throw new AppError("User profile data could not be retrieved", 404);
	}

	let isFollowing = false;
	if (currentUserId) {
		const followCheck = await userRepository.checkFollowRelation(
			currentUserId,
			targetUser.id,
		);
		isFollowing = !!followCheck;
	}

	const profilePayload: UserProfilePayload = { ...profile, isFollowing };

	await redis.set(cacheKey, profilePayload, cachedDurationSeconds);
	return profilePayload;
};

export const getUserPostsByUsername = async (username: string) => {
	const cacheKey = `profile:username:${username}:posts`;
	const cachedDurationSeconds = 1800;

	const cachedPosts = await redis.get<UserPostsPayload>(cacheKey);
	if (cachedPosts) return cachedPosts;

	const targetUser = await getTargetUser(username);
	const posts = await userRepository.findPostsByAuthorId(targetUser.id);

	await redis.set(cacheKey, posts, cachedDurationSeconds);
	return posts;
};

export const getUserCommentsByUsername = async (username: string) => {
	const cacheKey = `profile:username:${username}:comments`;
	const cachedDurationSeconds = 1800;

	const cachedComments = await redis.get<UserCommentsPayload>(cacheKey);
	if (cachedComments) return cachedComments;

	const targetUser = await getTargetUser(username);
	const comments = await userRepository.findCommentsByAuthorId(targetUser.id);

	await redis.set(cacheKey, comments, cachedDurationSeconds);
	return comments;
};

export const followUserAction = async (
	currentUserId: string,
	targetUsername: string,
) => {
	const targetUser = await getTargetUser(targetUsername);
	if (currentUserId === targetUser.id)
		throw new AppError("You cannot follow yourself", 400);

	await userRepository.createFollowRelation(currentUserId, targetUser.id);
	const currentUser = await userRepository.findById(currentUserId);
	if (currentUser) {
		await redis.delPattern(`profile:username:${currentUser.username}:*`);
	}
	await redis.delPattern(`profile:username:${targetUsername}:*`);
};

export const unfollowUserAction = async (
	currentUserId: string,
	targetUsername: string,
) => {
	const targetUser = await getTargetUser(targetUsername);
	await userRepository.deleteFollowRelation(currentUserId, targetUser.id);

	const currentUser = await userRepository.findById(currentUserId);
	if (currentUser) {
		await redis.delPattern(`profile:username:${currentUser.username}:*`);
	}
	await redis.delPattern(`profile:username:${targetUsername}:*`);
};

export const blockUserAction = async (
	currentUserId: string,
	targetUsername: string,
) => {
	const targetUser = await getTargetUser(targetUsername);
	if (currentUserId === targetUser.id)
		throw new AppError("You cannot block yourself", 400);

	await userRepository.deleteMutualFollows(currentUserId, targetUser.id);
	await userRepository.createBlockRelation(currentUserId, targetUser.id);

	const currentUser = await userRepository.findById(currentUserId);
	if (currentUser) {
		await redis.delPattern(`profile:username:${currentUser.username}:*`);
	}
	await redis.delPattern(`profile:username:${targetUsername}:*`);
};

export const unblockUserAction = async (
	currentUserId: string,
	targetUsername: string,
) => {
	const targetUser = await getTargetUser(targetUsername);
	await userRepository.deleteBlockRelation(currentUserId, targetUser.id);
	const currentUser = await userRepository.findById(currentUserId);
	if (currentUser) {
		await redis.delPattern(`profile:username:${currentUser.username}:*`);
	}
	await redis.delPattern(`profile:username:${targetUsername}:*`);
};

export const searchForUsers = async (data: UserSearchInput) => {
	const cacheKey = `search:users:${data.query.toLowerCase().trim()}:limit:${data.limit}`;
	const cachedDurationSeconds = 300;

	const cachedResults = await redis.get(cacheKey);
	if (cachedResults) return cachedResults;

	const users = await userRepository.searchUsers(data.query, data.limit);
	await redis.set(cacheKey, users, cachedDurationSeconds);
};
