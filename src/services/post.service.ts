import { AppError } from "../errors/AppError.js";
import type { VoteType } from "../generated/prisma/client.js";
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

/**
 * Resolves the caller's own vote for a page of posts in one query and folds it
 * into each row.
 *
 * Feed pages are cached without viewer context so every reader shares one
 * entry; the per-viewer field is layered on afterwards, on both the cache hit
 * and miss paths. Doing it here rather than in the repository keeps the cached
 * payload viewer-agnostic.
 */
const attachViewerVotes = async <T extends { id: string }>(
	posts: T[],
	viewerId?: string,
): Promise<(T & { currentUserVote: VoteType | null })[]> => {
	if (!viewerId || posts.length === 0) {
		return posts.map((post) => ({ ...post, currentUserVote: null }));
	}

	const votes = await postRepository.findViewerVotes(
		posts.map((post) => post.id),
		viewerId,
	);

	return posts.map((post) => ({
		...post,
		currentUserVote: votes.get(post.id) ?? null,
	}));
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
 * The cached page is viewer-agnostic; the caller's own vote is attached after
 * the cache lookup so one entry serves every reader.
 */
export const getAdvancedPostsFeed = async (
	filters: {
		sort?: "new" | "top" | "hot" | "controversial";
		community?: string;
		author?: string;
		cursor?: string;
		limit?: number;
	},
	viewerId?: string,
) => {
	// The filter set is hashed into the key so each sort/community/cursor
	// combination caches independently instead of overwriting one another.
	const filterHash = Buffer.from(JSON.stringify(filters)).toString("base64");
	const cacheKey = `feed:advanced:${filterHash}`;

	let feed = await redis.get<AdvancedFeedPayload>(cacheKey);
	if (!feed) {
		feed = await postRepository.getAdvancedFeed(filters);
		await redis.set(cacheKey, feed, 300);
	}

	return {
		...feed,
		posts: await attachViewerVotes(feed.posts, viewerId),
	};
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

	switch (action.action) {
		case "LOCK": {
			const caller = await prisma.user.findUnique({
				where: { id: userId },
				select: { role: true },
			});

			const isModOrAdmin =
				caller?.role === "MODERATOR" || caller?.role === "ADMIN";

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

			await redis.del(`post:${postId}`);
			await redis.delPattern("feed:advanced:*");

			if (nextIsLocked && isModOrAdmin) {
				await sendInternalNotification({
					recipientId: post.authorId,
					senderId: userId,
					type: "MOD_ACTION",
					title: "Your post has been locked",
					content: `A moderator locked your post: "${post.title}". New comments are disabled.`,
					link: `/posts/${postId}`,
				});
			}

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
			const updated = await postRepository.updatePinStatus(
				postId,
				action.isPinned,
			);
			await redis.del(`post:${postId}`);
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
 * Tallies are read straight off the post's denormalized columns, and the
 * viewer's vote arrives on the same row, so this is a single query.
 *
 * Cached per viewer, because `currentUserVote` varies by authentication state —
 * a shared entry would leak one user's vote to everyone else. Invalidation
 * therefore has to sweep the whole `post:<id>:vote_metrics:*` family.
 */
export const getPostVoteMetrics = async (
	postId: string,
	currentUserId?: string,
): Promise<VoteMetricsPayload> => {
	const cacheKey = `post:${postId}:vote_metrics:${currentUserId}`;

	const cachedMetrics = await redis.get<VoteMetricsPayload>(cacheKey);
	if (cachedMetrics) return cachedMetrics;

	const post = await postRepository.findByIdWithViewerVote(
		postId,
		currentUserId,
	);
	if (!post) throw new AppError("Post not found", 404);

	const metricsPayload: VoteMetricsPayload = {
		upvoteCount: post.upvoteCount,
		downvoteCount: post.downvoteCount,
		score: post.score,
		currentUserVote: post.votes?.[0]?.type ?? null,
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
