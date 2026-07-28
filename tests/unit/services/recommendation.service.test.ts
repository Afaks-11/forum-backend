import { describe, expect, it, jest } from "@jest/globals";

// Module Level Infrastructure Mocks typed safely using 'unknown'
const mockRecommendationRepository = {
	getSuggestedCommunities:
		jest.fn<(...args: unknown[]) => Promise<unknown[]>>(),
	getGlobalSuggestedCommunities:
		jest.fn<(...args: unknown[]) => Promise<unknown[]>>(),
	getUserInteractedCommunityIds:
		jest.fn<(...args: unknown[]) => Promise<string[]>>(),
	getRecommendedPostsFromCommunities:
		jest.fn<(...args: unknown[]) => Promise<unknown[]>>(),
};

const mockPostRepository = {
	getAdvancedFeed:
		jest.fn<(...args: unknown[]) => Promise<{ posts: unknown[] }>>(),
};

const mockRedis = {
	get: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	set: jest.fn<(...args: unknown[]) => Promise<void>>(),
};

// Isolate ES Modules prior to test environment execution
await jest.unstable_mockModule("../../../src/repositories/index.js", () => ({
	recommendationRepository: mockRecommendationRepository,
	postRepository: mockPostRepository,
}));
await jest.unstable_mockModule("../../../src/utils/redis.js", () => ({
	redis: mockRedis,
}));

// Resolve targeted operations under testing
const { getRecommendedCommunities, getRecommendedPosts } = await import(
	"../../../src/services/recommendation.service.js"
);

describe("Recommendation Service Unit Test Suite", () => {
	describe("getRecommendedCommunities", () => {
		it("Cache Hit Path: should return cached payload instantly without querying databases", async () => {
			mockRedis.get.mockReset();
			mockRecommendationRepository.getSuggestedCommunities.mockReset();
			mockRecommendationRepository.getGlobalSuggestedCommunities.mockReset();

			const fakeCachedPayload = [
				{ id: "comm_cached", name: "Cached Community", slug: "cached" },
			];
			mockRedis.get.mockResolvedValue(fakeCachedPayload);

			const result = await getRecommendedCommunities("usr_123", 5);

			expect(mockRedis.get).toHaveBeenCalledWith(
				"recommendations:communities:usr_123:limit:5",
			);
			expect(
				mockRecommendationRepository.getSuggestedCommunities,
			).not.toHaveBeenCalled();
			expect(
				mockRecommendationRepository.getGlobalSuggestedCommunities,
			).not.toHaveBeenCalled();
			expect(result).toEqual(fakeCachedPayload);
		});

		it("Cache Miss Path (User Exists + Personalized Data Present): should populate cache and return customized selection", async () => {
			mockRedis.get.mockReset();
			mockRedis.set.mockReset();
			mockRecommendationRepository.getSuggestedCommunities.mockReset();
			mockRecommendationRepository.getGlobalSuggestedCommunities.mockReset();

			mockRedis.get.mockResolvedValue(null);

			const dbPayload = [
				{ id: "comm_custom", name: "Custom Dynamic Tech", slug: "tech" },
			];
			mockRecommendationRepository.getSuggestedCommunities.mockResolvedValue(
				dbPayload,
			);

			const result = await getRecommendedCommunities("usr_123", 3);

			expect(
				mockRecommendationRepository.getSuggestedCommunities,
			).toHaveBeenCalledWith("usr_123", 3);
			expect(
				mockRecommendationRepository.getGlobalSuggestedCommunities,
			).not.toHaveBeenCalled();
			expect(mockRedis.set).toHaveBeenCalledWith(
				"recommendations:communities:usr_123:limit:3",
				dbPayload,
				600,
			);
			expect(result).toEqual(dbPayload);
		});

		it("Cache Miss Path (User Exists + Personalized Data Sparse Fallback): should query global sets if custom records are empty", async () => {
			mockRedis.get.mockReset();
			mockRedis.set.mockReset();
			mockRecommendationRepository.getSuggestedCommunities.mockReset();
			mockRecommendationRepository.getGlobalSuggestedCommunities.mockReset();

			mockRedis.get.mockResolvedValue(null);
			mockRecommendationRepository.getSuggestedCommunities.mockResolvedValue(
				[],
			); // Sparse response

			const globalTrends = [
				{
					id: "comm_global",
					name: "Global Announcements",
					slug: "announcements",
				},
			];
			mockRecommendationRepository.getGlobalSuggestedCommunities.mockResolvedValue(
				globalTrends,
			);

			const result = await getRecommendedCommunities("usr_123", 10);

			expect(
				mockRecommendationRepository.getSuggestedCommunities,
			).toHaveBeenCalledWith("usr_123", 10);
			expect(
				mockRecommendationRepository.getGlobalSuggestedCommunities,
			).toHaveBeenCalledWith(10);
			expect(mockRedis.set).toHaveBeenCalledWith(
				"recommendations:communities:usr_123:limit:10",
				globalTrends,
				600,
			);
			expect(result).toEqual(globalTrends);
		});

		it("Cache Miss Path (Guest User Context): should route to global fallback lists using anonymous signature keys", async () => {
			mockRedis.get.mockReset();
			mockRedis.set.mockReset();
			mockRecommendationRepository.getSuggestedCommunities.mockReset();
			mockRecommendationRepository.getGlobalSuggestedCommunities.mockReset();

			mockRedis.get.mockResolvedValue(null);

			const globalTrends = [
				{ id: "comm_all", name: "General Discussions", slug: "general" },
			];
			mockRecommendationRepository.getGlobalSuggestedCommunities.mockResolvedValue(
				globalTrends,
			);

			const result = await getRecommendedCommunities(null, 5);

			expect(mockRedis.get).toHaveBeenCalledWith(
				"recommendations:communities:guest:limit:5",
			);
			expect(
				mockRecommendationRepository.getSuggestedCommunities,
			).not.toHaveBeenCalled();
			expect(
				mockRecommendationRepository.getGlobalSuggestedCommunities,
			).toHaveBeenCalledWith(5);
			expect(mockRedis.set).toHaveBeenCalledWith(
				"recommendations:communities:guest:limit:5",
				globalTrends,
				600,
			);
			expect(result).toEqual(globalTrends);
		});
	});

	describe("getRecommendedPosts", () => {
		it("Cache Hit Path: should resolve matching payload objects cleanly from storage snapshots", async () => {
			mockRedis.get.mockReset();
			mockPostRepository.getAdvancedFeed.mockReset();
			mockRecommendationRepository.getUserInteractedCommunityIds.mockReset();

			const fakeCachedPosts = [
				{ id: "post_cached", title: "Cache Optimization Mechanics" },
			];
			mockRedis.get.mockResolvedValue(fakeCachedPosts);

			const result = await getRecommendedPosts("usr_123", 5);

			expect(mockRedis.get).toHaveBeenCalledWith(
				"recommendations:posts:usr_123:limit:5",
			);
			expect(mockPostRepository.getAdvancedFeed).not.toHaveBeenCalled();
			expect(
				mockRecommendationRepository.getUserInteractedCommunityIds,
			).not.toHaveBeenCalled();
			expect(result).toEqual(fakeCachedPosts);
		});

		it("Cache Miss Path (Guest User): should pull global chronological feed layouts without generating cache signatures", async () => {
			mockRedis.get.mockReset();
			mockRedis.set.mockReset();
			mockPostRepository.getAdvancedFeed.mockReset();

			mockRedis.get.mockResolvedValue(null);

			const defaultFeedResponse = {
				posts: [{ id: "post_new_1", title: "Brand New Guest Content Entry" }],
			};
			mockPostRepository.getAdvancedFeed.mockResolvedValue(defaultFeedResponse);

			const result = await getRecommendedPosts(null, 4);

			expect(mockRedis.get).toHaveBeenCalledWith(
				"recommendations:posts:guest:limit:4",
			);
			expect(mockPostRepository.getAdvancedFeed).toHaveBeenCalledWith({
				sort: "new",
				limit: 4,
			});
			expect(mockRedis.set).not.toHaveBeenCalled(); // Application layer bypasses cache on guest fallback path
			expect(result).toEqual(defaultFeedResponse.posts);
		});

		it("Cache Miss Path (User Present + No Interaction Context): should route directly to high-engagement global content lists", async () => {
			mockRedis.get.mockReset();
			mockRedis.set.mockReset();
			mockRecommendationRepository.getUserInteractedCommunityIds.mockReset();
			mockPostRepository.getAdvancedFeed.mockReset();

			mockRedis.get.mockResolvedValue(null);
			mockRecommendationRepository.getUserInteractedCommunityIds.mockResolvedValue(
				[],
			); // Empty interaction history

			const highEngagementFeed = {
				posts: [
					{
						id: "post_top_99",
						title: "Highly Ranked Network Engineering Paper",
					},
				],
			};
			mockPostRepository.getAdvancedFeed.mockResolvedValue(highEngagementFeed);

			const result = await getRecommendedPosts("usr_newbie", 6);

			expect(
				mockRecommendationRepository.getUserInteractedCommunityIds,
			).toHaveBeenCalledWith("usr_newbie");
			expect(mockPostRepository.getAdvancedFeed).toHaveBeenCalledWith({
				sort: "top",
				limit: 6,
			});
			expect(mockRedis.set).not.toHaveBeenCalled(); // Structural bypass on empty user interaction fallback
			expect(result).toEqual(highEngagementFeed.posts);
		});

		it("Cache Miss Path (User Present + Active Cluster Context Found): should run full preference matrix matches, cache, and return items", async () => {
			mockRedis.get.mockReset();
			mockRedis.set.mockReset();
			mockRecommendationRepository.getUserInteractedCommunityIds.mockReset();
			mockRecommendationRepository.getRecommendedPostsFromCommunities.mockReset();

			mockRedis.get.mockResolvedValue(null);
			mockRecommendationRepository.getUserInteractedCommunityIds.mockResolvedValue(
				["comm_kubernetes", "comm_linux"],
			);

			const targetedRecommendations = [
				{ id: "post_k8s_1", title: "Advanced Control Plane Architecture" },
			];
			mockRecommendationRepository.getRecommendedPostsFromCommunities.mockResolvedValue(
				targetedRecommendations,
			);

			const result = await getRecommendedPosts("usr_expert", 3);

			expect(
				mockRecommendationRepository.getUserInteractedCommunityIds,
			).toHaveBeenCalledWith("usr_expert");
			expect(
				mockRecommendationRepository.getRecommendedPostsFromCommunities,
			).toHaveBeenCalledWith(
				"usr_expert",
				["comm_kubernetes", "comm_linux"],
				3,
			);
			expect(mockRedis.set).toHaveBeenCalledWith(
				"recommendations:posts:usr_expert:limit:3",
				targetedRecommendations,
				300,
			);
			expect(result).toEqual(targetedRecommendations);
		});
	});
});
