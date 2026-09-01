import { redis } from "./redis.js";

export const postDetailCacheKey = (postId: string) => `post:${postId}`;

export const postVoteTallyCacheKey = (postId: string) =>
	`post:${postId}:vote_tally`;

export const invalidatePostCaches = async (postId: string): Promise<void> => {
	await redis.del([postDetailCacheKey(postId), postVoteTallyCacheKey(postId)]);
};
