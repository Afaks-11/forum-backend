import {
	postRepository,
	recommendationRepository,
} from "../repositories/index.js";
import { redis } from "../utils/redis.js";

export type SuggestedCommunitiesPayload = Awaited<
	ReturnType<typeof recommendationRepository.getSuggestedCommunities>
>;

export type RecommendedPostsPayload = Awaited<
	ReturnType<typeof recommendationRepository.getRecommendedPostsFromCommunities>
>;

/**
 * Compiles personalized community suggestions for a user.
 */
export const getRecommendedCommunities = async (
	userId: string | null,
	limit: number,
) => {
	const cacheKey = `recommendations:communities:${userId ?? "guest"}:limit:${limit}`;

	const cached = await redis.get<SuggestedCommunitiesPayload>(cacheKey);
	if (cached) return cached;

	let communities: SuggestedCommunitiesPayload;
	if (userId) {
		communities = await recommendationRepository.getSuggestedCommunities(
			userId,
			limit,
		);
		// Fallback to global trends if personalized suggestions are sparse
		if (communities.length === 0) {
			communities =
				await recommendationRepository.getGlobalSuggestedCommunities(limit);
		}
	} else {
		communities =
			await recommendationRepository.getGlobalSuggestedCommunities(limit);
	}

	await redis.set(cacheKey, communities, 600); // 10-minute cache window
	return communities;
};

/**
 * Builds a personalized interest graph feed of posts.
 */
export const getRecommendedPosts = async (
	userId: string | null,
	limit: number,
) => {
	const cacheKey = `recommendations:posts:${userId ?? "guest"}:limit:${limit}`;

	const cached = await redis.get<RecommendedPostsPayload>(cacheKey);
	if (cached) return cached;

	if (!userId) {
		// Guests receive the current global "New" feed as a fallback
		const defaultFeed = await postRepository.getAdvancedFeed({
			sort: "new",
			limit,
		});
		return defaultFeed.posts;
	}

	// Analyze user affinity clusters
	const preferredCommunities =
		await recommendationRepository.getUserInteractedCommunityIds(userId);

	if (preferredCommunities.length === 0) {
		// If the user has no history yet, fall back to global high-engagement content
		const defaultFeed = await postRepository.getAdvancedFeed({
			sort: "top",
			limit,
		});
		return defaultFeed.posts;
	}

	// Extract personalized content matching the affinity clusters
	const recommendedPosts =
		await recommendationRepository.getRecommendedPostsFromCommunities(
			userId,
			preferredCommunities,
			limit,
		);

	await redis.set(cacheKey, recommendedPosts, 300); // 5-minute cache lifespan
	return recommendedPosts;
};
