import { AppError } from "../errors/AppError.js";
import {
	communityRepository,
	postRepository,
	reportRepository,
} from "../repositories/index.js";
import { prisma } from "../utils/prisma.js";
import { redis } from "../utils/redis.js";
import type {
	CreatePostInput,
	PostSearchInput,
} from "../validators/post.validator.js";
import { sendInternalNotification } from "./notification.service.js";

type PostPayload = NonNullable<
	Awaited<ReturnType<typeof postRepository.findById>>
>;
type AdvancedFeedPayload = Awaited<
	ReturnType<typeof postRepository.getAdvancedFeed>
>;

type SearchPostsResult = Awaited<ReturnType<typeof postRepository.searchPosts>>;

interface VoteMetricsPayload {
	upvotes: number;
	downvotes: number;
	score: number;
	currentUserVote: string | null;
}

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
	const cacheKey = `post:${id}`;

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

	await redis.del(`post:${postId}`);
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

	await redis.del(`post:${postId}`);
	await redis.delPattern("feed:advanced:*");
	await redis.delPattern("feed:community:*");

	return result;
};

/**
 * Cursor-paginated feed with sort and filter support, cached for five minutes.
 */
export const getAdvancedPostsFeed = async (filters: {
	sort?: "new" | "top" | "hot" | "controversial";
	community?: string;
	author?: string;
	cursor?: string;
	limit?: number;
}) => {
	// The filter set is hashed into the key so each sort/community/cursor
	// combination caches independently instead of overwriting one another.
	const filterHash = Buffer.from(JSON.stringify(filters)).toString("base64");
	const cacheKey = `feed:advanced:${filterHash}`;

	const cachedFeed = await redis.get<AdvancedFeedPayload>(cacheKey);
	if (cachedFeed) return cachedFeed;

	const feed = await postRepository.getAdvancedFeed(filters);
	await redis.set(cacheKey, feed, 300);

	return feed;
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
	action: "PIN" | "LOCK" | "HIDE" | "REPORT",
	isLocked: boolean,
	isPinned: boolean,
	reasonText?: string,
) => {
	const post = await postRepository.findUniqueById(postId);
	if (!post || post.deletedAt) throw new AppError("Post not found", 404);

	switch (action) {
		case "LOCK": {
			const caller = await prisma.user.findUnique({
				where: { id: userId },
				select: { role: true },
			});
			const isModOrAdmin =
				caller?.role === "MODERATOR" || caller?.role === "ADMIN";
			if (post.authorId !== userId && !isModOrAdmin) {
				throw new AppError("Forbidden: insufficient privileges", 403);
			}
			const updated = await postRepository.updateLockStatus(postId, isLocked);

			await redis.del(`post:${postId}`);
			await redis.delPattern("feed:advanced:*");

			await sendInternalNotification({
				recipientId: post.authorId,
				senderId: userId,
				type: "MOD_ACTION",
				title: "Your post has been locked",
				content: `A moderator locked your post: "${post.title}". New comments are disabled.`,
				link: `/posts/${postId}`,
			});
			return updated;
		}

		case "PIN": {
			const caller = await prisma.user.findUnique({
				where: { id: userId },
				select: { role: true },
			});
			const isModOrAdmin =
				caller?.role === "MODERATOR" || caller?.role === "ADMIN";
			if (!isModOrAdmin) {
				throw new AppError("Forbidden: Moderator privileges required", 403);
			}
			const updated = await postRepository.updatePinStatus(postId, isPinned);
			await redis.del(`post:${postId}`);
			await redis.delPattern("feed:advanced:*");
			return updated;
		}

		case "REPORT":
			return await reportRepository.create(postId, userId, reasonText);

		case "HIDE":
			// Hiding is a per-viewer preference held client-side; there is no
			// server-side state to mutate, so this branch is a deliberate no-op.
			return { success: true, message: "Cached user-hide request processed" };
	}
};

/**
 * Returns a post's vote tally plus the caller's own vote.
 *
 * Cached per viewer, because `currentUserVote` varies by authentication state —
 * a shared entry would leak one user's vote to everyone else. Invalidation
 * therefore has to sweep the whole `post:<id>:vote_metrics:*` family.
 */
export const getPostVoteMetrics = async (
	postId: string,
	currentUserId?: string,
) => {
	const viewerContext = currentUserId;
	const cacheKey = `post:${postId}:vote_metrics:${viewerContext}`;

	const cachedMetrics = await redis.get<VoteMetricsPayload>(cacheKey);
	if (cachedMetrics) return cachedMetrics;

	const post = await prisma.post.findUnique({
		where: { id: postId, deletedAt: null },
	});
	if (!post) throw new AppError("Post not found", 404);

	const { upvotes, downvotes } = await postRepository.getVoteMetrics(postId);

	let userVoteState: string | null = null;
	if (currentUserId) {
		const activeVote = await postRepository.getUserVote(postId, currentUserId);
		if (activeVote) {
			userVoteState = activeVote.type;
		}
	}

	const metricsPayload: VoteMetricsPayload = {
		upvotes,
		downvotes,
		score: upvotes - downvotes,
		currentUserVote: userVoteState,
	};

	await redis.set(cacheKey, metricsPayload, 60);
	return metricsPayload;
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
