import { AppError } from "../errors/AppError.js";
import { userRepository } from "../repositories/index.js";
import { redis } from "../utils/redis.js";
import type {
	SavedItemsQueryInput,
	UserSearchInput,
} from "../validators/user.validator.js";
import { sendInternalNotification } from "./notification.service.js";

type UserProfileCorePayload = NonNullable<
	Awaited<ReturnType<typeof userRepository.findProfileWithCounters>>
>;
type UserProfilePayload = UserProfileCorePayload & {
	isFollowing: boolean;
};
type UserPostsPayload = Awaited<
	ReturnType<typeof userRepository.findPostsByAuthorId>
>;
type UserCommentsPayload = Awaited<
	ReturnType<typeof userRepository.findCommentsByAuthorId>
>;

/** Cache key for a username's viewer-agnostic public profile payload. */
const profileCacheKey = (username: string) =>
	`profile:username:${username}:profile`;

/** Cache key for a username's authored post list. */
const profilePostsCacheKey = (username: string) =>
	`profile:username:${username}:posts`;

/** Cache key for a username's authored comment list. */
const profileCommentsCacheKey = (username: string) =>
	`profile:username:${username}:comments`;

const getTargetUser = async (username: string) => {
	const target = await userRepository.findByUsername(username);
	if (!target) throw new AppError("Target user not found", 404);
	return target;
};

/**
 * Drops the cached profiles of both sides of a relationship change.
 *
 * Only the two profile payloads move: each carries follower/following counters
 * that a follow or block has just changed. The authored post and comment lists
 * are unaffected, so they are deliberately left warm — and because the payload
 * is viewer-agnostic these are exact-key deletes rather than the four
 * `profile:username:*:viewer:*` SCAN sweeps this used to require per follow.
 */
const invalidateProfilePair = async (
	currentUserId: string,
	targetUsername: string,
): Promise<void> => {
	const keys = [profileCacheKey(targetUsername)];

	const currentUser = await userRepository.findById(currentUserId);
	if (currentUser) keys.push(profileCacheKey(currentUser.username));

	await redis.del(keys);
};

/**
 * Returns a public profile with follower counters and the viewer's follow state.
 *
 * The cached payload is viewer-agnostic; `isFollowing` and the block check are
 * evaluated after the cache read against the target id carried in the payload.
 * A per-viewer key would be correct too, but it fragments the cache into one
 * entry per reader and makes every follow or block a keyspace scan.
 */
export const getUserProfileByUsername = async (
	username: string,
	currentUserId?: string,
) => {
	const cacheKey = profileCacheKey(username);

	let profile = await redis.get<UserProfileCorePayload>(cacheKey);

	if (!profile) {
		const targetUser = await getTargetUser(username);
		const fetched = await userRepository.findProfileWithCounters(targetUser.id);
		if (!fetched) {
			throw new AppError("User profile data could not be retrieved", 404);
		}

		profile = fetched;
		await redis.set(cacheKey, profile, 3600);
	}

	if (currentUserId) {
		const isBlocked = await userRepository.checkBlockRelation(
			currentUserId,
			profile.id,
		);
		// Report a block as "not found" rather than 403: confirming the profile
		// exists but is blocked would tell the blocked party they were blocked.
		if (isBlocked) throw new AppError("Profile unavailable", 404);
	}

	let isFollowing = false;
	if (currentUserId) {
		const followCheck = await userRepository.checkFollowRelation(
			currentUserId,
			profile.id,
		);
		isFollowing = !!followCheck;
	}

	const profilePayload: UserProfilePayload = { ...profile, isFollowing };
	return profilePayload;
};

export const getUserPostsByUsername = async (username: string) => {
	const cacheKey = profilePostsCacheKey(username);
	const cachedDurationSeconds = 1800;

	const cachedPosts = await redis.get<UserPostsPayload>(cacheKey);
	if (cachedPosts) return cachedPosts;

	const targetUser = await getTargetUser(username);
	const posts = await userRepository.findPostsByAuthorId(targetUser.id);

	await redis.set(cacheKey, posts, cachedDurationSeconds);
	return posts;
};

export const getUserCommentsByUsername = async (username: string) => {
	const cacheKey = profileCommentsCacheKey(username);
	const cachedDurationSeconds = 1800;

	const cachedComments = await redis.get<UserCommentsPayload>(cacheKey);
	if (cachedComments) return cachedComments;

	const targetUser = await getTargetUser(username);
	const comments = await userRepository.findCommentsByAuthorId(targetUser.id);

	await redis.set(cacheKey, comments, cachedDurationSeconds);
	return comments;
};

/**
 * Follows a user and notifies them.
 *
 * Both profiles are invalidated because each one's cached follower/following
 * counters and `isFollowing` flag have just changed.
 */
export const followUserAction = async (
	currentUserId: string,
	targetUsername: string,
) => {
	const targetUser = await getTargetUser(targetUsername);
	if (currentUserId === targetUser.id)
		throw new AppError("You cannot follow yourself", 400);

	await userRepository.createFollowRelation(currentUserId, targetUser.id);
	await invalidateProfilePair(currentUserId, targetUsername);

	const follower = await userRepository.findById(currentUserId);

	// The NEW_FOLLOWER notification type existed in the schema, the queue payload
	// union, and the repository union, but nothing ever produced one — following
	// someone notified nobody. The stable relation key deduplicates a retried
	// follow request while its completed BullMQ job is retained.
	await sendInternalNotification({
		recipientId: targetUser.id,
		senderId: currentUserId,
		type: "NEW_FOLLOWER",
		dedupeKey: currentUserId,
		title: "You have a new follower",
		content: `@${follower?.username ?? "Someone"} started following you.`,
		...(follower ? { link: `/users/${follower.username}` } : {}),
	});
};

/**
 * Removes a follow relation and invalidates both sides' cached profiles.
 */
export const unfollowUserAction = async (
	currentUserId: string,
	targetUsername: string,
) => {
	const targetUser = await getTargetUser(targetUsername);
	await userRepository.deleteFollowRelation(currentUserId, targetUser.id);

	await invalidateProfilePair(currentUserId, targetUsername);
};

/**
 * Blocks a user, tearing down any follow relation in either direction first so
 * a block cannot be circumvented by a pre-existing follow.
 */
export const blockUserAction = async (
	currentUserId: string,
	targetUsername: string,
) => {
	const targetUser = await getTargetUser(targetUsername);
	if (currentUserId === targetUser.id)
		throw new AppError("You cannot block yourself", 400);

	await userRepository.deleteMutualFollows(currentUserId, targetUser.id);
	await userRepository.createBlockRelation(currentUserId, targetUser.id);

	await invalidateProfilePair(currentUserId, targetUsername);
};

/**
 * Lifts a block. Follows severed by the original block are not restored.
 */
export const unblockUserAction = async (
	currentUserId: string,
	targetUsername: string,
) => {
	const targetUser = await getTargetUser(targetUsername);
	await userRepository.deleteBlockRelation(currentUserId, targetUser.id);

	await invalidateProfilePair(currentUserId, targetUsername);
};

export const searchForUsers = async (data: UserSearchInput) => {
	const cacheKey = `search:users:${data.query.toLowerCase().trim()}:limit:${data.limit}`;
	const cachedDurationSeconds = 300;

	const cachedResults = await redis.get(cacheKey);
	if (cachedResults) return cachedResults;

	const users = await userRepository.searchUsers(data.query, data.limit);
	await redis.set(cacheKey, users, cachedDurationSeconds);

	return users;
};

export const getSavedPosts = async (
	userId: string,
	query: SavedItemsQueryInput,
) => userRepository.findSavedPosts(userId, query.limit, query.cursor);

export const getSavedComments = async (
	userId: string,
	query: SavedItemsQueryInput,
) => userRepository.findSavedComments(userId, query.limit, query.cursor);
