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

export const getPostById = async (id: string) => {
	const cacheKey = `post:${id}`;

	const cachedPost = await redis.get<PostPayload>(cacheKey);
	if (cachedPost) return cachedPost;

	const post = await postRepository.findById(id);
	if (!post) throw new AppError("Post not found or has been removed", 404);

	await redis.set(cacheKey, post, 3600);
	return post;
};

export const updatePostFields = async (
	postId: string,
	userId: string,
	data: { title?: string; content?: string },
) => {
	const post = await postRepository.findUniqueById(postId);
	if (!post || post.deletedAt) throw new AppError("Post not found", 404);
	if (post.authorId !== userId)
		throw new AppError("Forbidden: You do not own this post", 403);

	// Avoid exactOptionalPropertyTypes compilation block by safely processing missing elements
	const updatePayload: { title?: string; content?: string } = {};
	if (data.title !== undefined) updatePayload.title = data.title;
	if (data.content !== undefined) updatePayload.content = data.content;

	const updatedPost = await postRepository.update(postId, updatePayload);

	await redis.del(`post:${postId}`);
	await redis.delPattern("feed:advanced:*");
	await redis.delPattern("feed:community:*");

	return updatedPost;
};

// export const getAllActivePosts = async () => {
// 	return await prisma.post.findMany({
// 		where: {
// 			deletedAt: null,
// 		},
// 		include: {
// 			user: {
// 				select: { username: true },
// 			},
// 			community: {
// 				select: { name: true },
// 			},
// 		},
// 		orderBy: { createdAt: "desc" },
// 	});
// };

export const softDeletePost = async (postId: string, userId: string) => {
	const post = await postRepository.findUniqueById(postId);
	if (!post) throw new AppError("Post not found", 404);
	if (post.authorId !== userId)
		throw new AppError("Unauthorized to delete this post", 401);

	const result = await postRepository.softDelete(postId);

	await redis.del(`post:${postId}`);
	await redis.delPattern("feed:advanced:*");
	await redis.delPattern("feed:community:*");

	return result;
};

export const getAdvancedPostsFeed = async (filters: {
	sort?: "new" | "top" | "hot" | "controversial";
	community?: string;
	author?: string;
	cursor?: string;
	limit?: number;
}) => {
	const filterHash = Buffer.from(JSON.stringify(filters)).toString("base64");
	const cacheKey = `feed:advanced:${filterHash}`;

	const cachedFeed = await redis.get<AdvancedFeedPayload>(cacheKey);
	if (cachedFeed) return cachedFeed;

	const feed = await postRepository.getAdvancedFeed(filters);
	await redis.set(cacheKey, feed, 300);

	return feed;
};

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
			if (post.authorId !== userId)
				throw new AppError("Unauthorized action", 401);
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
			const updated = await postRepository.updatePinStatus(postId, isPinned);
			await redis.del(`post:${postId}`);
			await redis.delPattern("feed:advanced:*");
			return updated;
		}

		case "REPORT":
			return await reportRepository.create(postId, userId, reasonText);

		case "HIDE":
			return { success: true, message: "Cached user-hide request processed" };
	}
};

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

export const searchForPosts = async (
	data: PostSearchInput,
): Promise<SearchPostsResult> => {
	const normalizedQuery = data.query.toLowerCase().trim();
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
