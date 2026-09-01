import { describe, expect, it, jest } from "@jest/globals";

// Module Level Repository and Cache Interface Mocks typed safely using 'unknown'
const mockPostRepository = {
	findManyByIds: jest.fn<(...args: unknown[]) => Promise<unknown[]>>(),
	findViewerVotes:
		jest.fn<(...args: unknown[]) => Promise<Map<string, string>>>(),
	getAdvancedFeed: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
};

const mockZrevrange = jest.fn<(...args: unknown[]) => Promise<string[]>>();
const mockRedis = {
	getClient: jest.fn<(...args: unknown[]) => unknown>(),
	get: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	set: jest.fn<(...args: unknown[]) => Promise<void>>(),
};

// Isolate ES Modules prior to test environment execution
await jest.unstable_mockModule("../../../src/repositories/index.js", () => ({
	postRepository: mockPostRepository,
}));
await jest.unstable_mockModule("../../../src/utils/redis.js", () => ({
	redis: mockRedis,
}));

// Resolve targeted operations under testing
const { getAdvancedPostsFeed } = await import(
	"../../../src/services/feed.service.js"
);

describe("Feed Service Unit Test Suite", () => {
	describe("getAdvancedPostsFeed", () => {
		// --- PATH 1: REDIS ZSET ALGORITHMIC PATHS (HOT / CONTROVERSIAL) ---
		describe("Algorithmic Optimization Path (Redis ZSET)", () => {
			it("should retrieve ranked feeds directly via Redis ZSET scores when sorting by hot parameters without contextual overrides", async () => {
				mockZrevrange.mockReset();
				mockPostRepository.findManyByIds.mockReset();
				mockRedis.getClient.mockReset();

				// Explicitly map socket/redis implementations inside this execution context
				mockZrevrange
					.mockResolvedValueOnce(["post_3", "post_1"])
					.mockResolvedValueOnce(["post_99"]);

				mockRedis.getClient.mockImplementation(() => ({
					zrevrange: mockZrevrange,
				}));

				const rawDbPosts = [
					{ id: "post_1", title: "Post One Architecture Breakdown" },
					{ id: "post_3", title: "Post Three System Overview" },
				];
				mockPostRepository.findManyByIds.mockResolvedValue(rawDbPosts);

				const result = await getAdvancedPostsFeed({ sort: "hot", limit: 2 });

				expect(mockRedis.getClient).toHaveBeenCalled();
				expect(mockZrevrange).toHaveBeenNthCalledWith(
					1,
					"feed:global:hot",
					0,
					1,
				);
				expect(mockPostRepository.findManyByIds).toHaveBeenCalledWith([
					"post_3",
					"post_1",
				]);

				expect(result.posts).toEqual([
					{
						id: "post_3",
						title: "Post Three System Overview",
						currentUserVote: null,
					},
					{
						id: "post_1",
						title: "Post One Architecture Breakdown",
						currentUserVote: null,
					},
				]);
				expect(result.nextCursor).toBe("2");
			});

			it("should provide an explicit null cursor assignment when no supplemental entries remain in algorithmic rank indexes", async () => {
				mockZrevrange.mockReset();
				mockPostRepository.findManyByIds.mockReset();
				mockRedis.getClient.mockReset();

				mockZrevrange
					.mockResolvedValueOnce(["post_5"])
					.mockResolvedValueOnce([]);

				mockRedis.getClient.mockImplementation(() => ({
					zrevrange: mockZrevrange,
				}));

				mockPostRepository.findManyByIds.mockResolvedValue([
					{ id: "post_5", title: "Solitary Post" },
				]);

				const result = await getAdvancedPostsFeed({
					sort: "controversial",
					cursor: "10",
					limit: 5,
				});

				expect(mockZrevrange).toHaveBeenNthCalledWith(
					1,
					"feed:global:controversial",
					10,
					14,
				);
				expect(mockZrevrange).toHaveBeenNthCalledWith(
					2,
					"feed:global:controversial",
					15,
					15,
				);
				expect(result.nextCursor).toBeNull();
			});
		});

		// --- PATH 2: CHRONOLOGICAL & OVERRIDDEN CACHE FILTERS ---
		describe("Standard Chronological Cache Layers", () => {
			it("should instantly return decoded data matching serialized base64 signatures on application cache hits", async () => {
				mockRedis.get.mockReset();
				mockPostRepository.getAdvancedFeed.mockReset();

				const fakeCachedPayload = {
					posts: [
						{ id: "post_cached_99", title: "Performant In-Memory Post Buffer" },
					],
					nextCursor: "post_cached_100",
				};
				mockRedis.get.mockResolvedValue(fakeCachedPayload);

				const result = await getAdvancedPostsFeed({
					sort: "new",
					community: "distributed-systems",
				});

				const expectedHash = Buffer.from(
					JSON.stringify({
						sort: "new",
						limit: 10,
						community: "distributed-systems",
					}),
				).toString("base64");

				expect(mockRedis.get).toHaveBeenCalledWith(
					`feed:advanced:${expectedHash}`,
				);
				expect(mockPostRepository.getAdvancedFeed).not.toHaveBeenCalled();
				expect(result).toEqual({
					...fakeCachedPayload,
					posts: fakeCachedPayload.posts.map((post) => ({
						...post,
						currentUserVote: null,
					})),
				});
			});

			it("should interface with database persistence layers and populate cache instances on infrastructure misses", async () => {
				mockRedis.get.mockReset();
				mockRedis.set.mockReset();
				mockPostRepository.getAdvancedFeed.mockReset();

				mockRedis.get.mockResolvedValue(null);

				const dbFeedResponse = {
					posts: [{ id: "post_db_77", title: "Direct Read Engine Post" }],
					nextCursor: null,
				};
				mockPostRepository.getAdvancedFeed.mockResolvedValue(dbFeedResponse);

				const result = await getAdvancedPostsFeed({
					sort: "top",
					author: "staff-engineer-1",
				});

				const expectedHash = Buffer.from(
					JSON.stringify({
						sort: "top",
						limit: 10,
						author: "staff-engineer-1",
					}),
				).toString("base64");

				expect(mockPostRepository.getAdvancedFeed).toHaveBeenCalledWith({
					sort: "top",
					limit: 10,
					author: "staff-engineer-1",
				});
				expect(mockRedis.set).toHaveBeenCalledWith(
					`feed:advanced:${expectedHash}`,
					dbFeedResponse,
					300,
				);
				expect(result).toEqual({
					...dbFeedResponse,
					posts: dbFeedResponse.posts.map((post) => ({
						...post,
						currentUserVote: null,
					})),
				});
			});
		});
	});
});
