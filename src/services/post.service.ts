import { AppError } from "../errors/AppError.js";
import type { VoteType } from "../generated/prisma/client.js";
import {
	communityRepository,
	postRepository,
	reportRepository,
	userRepository,
} from "../repositories/index.js";
import {
	invalidatePostCaches,
	postDetailCacheKey,
	postVoteTallyCacheKey,
} from "../utils/postCache.js";
import { redis } from "../utils/redis.js";
import { isAdmin } from "../utils/roles.js";
import type {
	CreatePostInput,
	PostSearchInput,
} from "../validators/post.validator.js";
import { sendInternalNotification } from "./notification.service.js";

type PostPayload = NonNullable<
	Awaited<ReturnType<typeof postRepository.findById>>
>;
type SearchPostsResult = Awaited<ReturnType<typeof postRepository.searchPosts>>;

export type ModerationAction =
	| {
			action: "LOCK";
			isLocked: boolean | undefined;
	  }
	| { action: "PIN"; isPinned: boolean }
	| {
			action: "REPORT";
			reason: string | undefined;
	  }
	| {
			action: "HIDE";
	  };
interface VoteMetricsPayload {
	upvoteCount: number;
	downvoteCount: number;
	score: number;
	currentUserVote: VoteType | null;
}

/** Viewer-agnostic half of the vote metrics payload — the part worth caching. */
type VoteTallyPayload = Omit<VoteMetricsPayload, "currentUserVote">;

/**
 * Resolves one viewer's own vote on a post via the `(userId, postId)` unique.
 *
 * Kept out of the cached payload so the cached value stays viewer-agnostic; the
 * lookup it replaces is a single indexed read.
 */
const resolveViewerVote = async (
	postId: string,
	viewerId?: string,
): Promise<VoteType | null> => {
	if (!viewerId) return null;

	const votes = await postRepository.findViewerVotes([postId], viewerId);
	return votes.get(postId) ?? null;
};

/**
 * Creates a post inside an existing community.
 * Every cached feed variant is dropped because a new post can appear in any of
 * them regardless of the sort or filter that produced the cached entry.
 */
export const createPost = async (data: CreatePostInput, authorId: string) => {
	const community = await communityRepository.findById(data.communityId);
	if (!community) {
		throw new AppError("Target community not found", 404);
	}

	const newPost = await postRepository.create(data, authorId);
	await redis.delPattern("feed:advanced:*");
	await redis.del(`feed:community:${community.slug}`);

	return newPost;
};

/**
 * Fetches a single post through a one-hour cache.
 * Soft-deleted posts are excluded by the repository, so this 404s for them.
 */
export const getPostById = async (id: string) => {
	const cacheKey = postDetailCacheKey(id);

	const cachedPost = await redis.get<PostPayload>(cacheKey);
	if (cachedPost) return cachedPost;

	const post = await postRepository.findById(id);
	if (!post) throw new AppError("Post not found or has been removed", 404);

	await redis.set(cacheKey, post, 3600);
	return post;
};

/**
 * Edits a post's title and/or content. Author-only.
 */
export const updatePostFields = async (
	postId: string,
	userId: string,
	data: { title?: string; content?: string },
) => {
	const post = await postRepository.findUniqueById(postId);
	if (!post || post.deletedAt) throw new AppError("Post not found", 404);
	if (post.authorId !== userId)
		throw new AppError("Forbidden: You do not own this post", 403);

	const updatePayload: { title?: string; content?: string } = {};
	if (data.title !== undefined) updatePayload.title = data.title;
	if (data.content !== undefined) updatePayload.content = data.content;

	const updatedPost = await postRepository.update(postId, updatePayload);

	await invalidatePostCaches(postId);
	await redis.delPattern("feed:advanced:*");
	await redis.delPattern("feed:community:*");

	return updatedPost;
};

/**
 * Marks a post deleted without removing the row, so its comments, votes, and
 * moderation history remain intact for auditing. Author-only.
 */
export const softDeletePost = async (postId: string, userId: string) => {
	const post = await postRepository.findUniqueById(postId);
	if (!post) throw new AppError("Post not found", 404);
	if (post.authorId !== userId)
		throw new AppError("Unauthorized to delete this post", 403);

	const result = await postRepository.softDelete(postId);

	await invalidatePostCaches(postId);
	await redis.delPattern("feed:advanced:*");
	await redis.delPattern("feed:community:*");

	return result;
};

/**
 * Adds or removes a post from the caller's saved list.
 */
export const savePostAction = async (
	postId: string,
	userId: string,
	action: "SAVE" | "UNSAVE",
) => {
	const post = await postRepository.findUniqueById(postId);
	if (!post || post.deletedAt) throw new AppError("Post not found", 404);

	if (action === "SAVE") {
		await postRepository.save(postId, userId);
	} else {
		await postRepository.unsave(postId, userId);
	}
};

/**
 * Applies a moderation action to a post. Each branch enforces its own
 * authorization: LOCK allows the author or a mod/admin, PIN is mod/admin only,
 * and REPORT is open to any authenticated user.
 */
export const modifyPostModerationState = async (
	postId: string,
	userId: string,
	action: ModerationAction,
) => {
	const post = await postRepository.findUniqueById(postId);
	if (!post || post.deletedAt) throw new AppError("Post not found", 404);

	const caller = await userRepository.findById(userId);
	const hasAdminRole = isAdmin(caller?.role);

	let isCommunityMod = false;
	if (post.communityId) {
		const membership = await communityRepository.findMembership(
			userId,
			post.communityId,
		);
		isCommunityMod = membership?.role === "MODERATOR";
	}

	const isModOrAdmin = hasAdminRole || isCommunityMod;

	switch (action.action) {
		case "LOCK": {
			const isAuthor = post.authorId === userId;
			if (!isAuthor && !isModOrAdmin) {
				throw new AppError("Forbidden: insufficient privileges", 403);
			}

			let nextIsLocked: boolean;
			let lockSetById: string | null;

			if (isModOrAdmin) {
				if (action.isLocked === undefined) {
					throw new AppError("Staff must specify isLocked", 400);
				}

				nextIsLocked = action.isLocked;
				lockSetById = nextIsLocked ? userId : null;
			} else {
				if (action.isLocked === false && post.lockSetById !== userId) {
					throw new AppError(
						"Forbidden: you cannot unlock a moderator lock",
						403,
					);
				}

				nextIsLocked = action.isLocked ?? true;
				lockSetById = nextIsLocked ? userId : null;
			}

			const updated = await postRepository.updateLockStatus(
				postId,
				nextIsLocked,
				lockSetById,
			);

			await invalidatePostCaches(postId);
			await redis.delPattern("feed:advanced:*");

			if (nextIsLocked && isModOrAdmin) {
				await sendInternalNotification({
					recipientId: post.authorId,
					senderId: userId,
					type: "MOD_ACTION",
					dedupeKey: `post-lock:${postId}:${nextIsLocked}`,
					title: "Your post has been locked",
					content: `A moderator locked your post: "${post.title}". New comments are disabled.`,
					link: `/posts/${postId}`,
				});
			}

			return updated;
		}

		case "PIN": {
			if (!isModOrAdmin) {
				throw new AppError("Forbidden: Moderator privileges required", 403);
			}
			const updated = await postRepository.updatePinStatus(
				postId,
				action.isPinned,
			);
			await invalidatePostCaches(postId);
			await redis.delPattern("feed:advanced:*");
			return updated;
		}

		case "REPORT":
			return await reportRepository.create(postId, userId, action.reason);

		case "HIDE":
			// Hiding is a per-viewer preference held client-side; there is no
			// server-side state to mutate, so this branch is a deliberate no-op.
			return { success: true, message: "Cached user-hide request processed" };
	}
};

/**
 * Returns a post's vote tally plus the caller's own vote.
 *
 * Only the tally is cached, under one viewer-agnostic key. The previous shape
 * (`post:<id>:vote_metrics:<viewerId>`) baked `currentUserVote` into the cached
 * value, which fragmented the cache into one entry per reader and forced a SCAN
 * sweep of the whole family on *every vote* — a keyspace scan on the hottest
 * write path in the system. Layering the viewer's own vote on afterwards, the
 * way the feed already does, makes invalidation a single exact-key delete and
 * lets one entry serve every reader.
 */
export const getPostVoteMetrics = async (
	postId: string,
	currentUserId?: string,
): Promise<VoteMetricsPayload> => {
	const cacheKey = postVoteTallyCacheKey(postId);

	const cachedTally = await redis.get<VoteTallyPayload>(cacheKey);
	if (cachedTally) {
		return {
			...cachedTally,
			currentUserVote: await resolveViewerVote(postId, currentUserId),
		};
	}

	const post = await postRepository.findByIdWithViewerVote(
		postId,
		currentUserId,
	);
	if (!post) throw new AppError("Post not found", 404);

	const tally: VoteTallyPayload = {
		upvoteCount: post.upvoteCount,
		downvoteCount: post.downvoteCount,
		score: post.score,
	};

	await redis.set(cacheKey, tally, 60);

	return {
		...tally,
		currentUserVote: post.votes?.[0]?.type ?? null,
	};
};

/**
 * Cursor-paginated post search with a three-minute cache.
 */
export const searchForPosts = async (
	data: PostSearchInput,
): Promise<SearchPostsResult> => {
	const normalizedQuery = data.query.toLowerCase().trim();
	// A literal stands in for the first page so the key shape stays uniform;
	// an empty segment would make `cursor:` collide across distinct queries.
	const safeCursor = data.cursor || "none";

	const cacheKey = `search:posts:${normalizedQuery}:limit:${data.limit}:cursor:${safeCursor}`;
	const TTL_SECONDS = 180;

	const cached = await redis.get<SearchPostsResult>(cacheKey);
	if (cached) return cached;

	const searchResult = await postRepository.searchPosts({
		query: data.query,
		limit: data.limit,
		cursor: data.cursor ?? null,
	});

	await redis.set(cacheKey, searchResult, TTL_SECONDS);

	return searchResult;
};
