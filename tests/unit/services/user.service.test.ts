import { describe, expect, it, jest } from "@jest/globals";
import { AppError } from "../../../src/errors/AppError.js";

// Module Level Infrastructure Mocks typed safely using 'unknown'
const mockUserRepository = {
	findByUsername: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	checkBlockRelation: jest.fn<(...args: unknown[]) => Promise<boolean>>(),
	findProfileWithCounters: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	checkFollowRelation: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	findPostsByAuthorId: jest.fn<(...args: unknown[]) => Promise<unknown[]>>(),
	findCommentsByAuthorId: jest.fn<(...args: unknown[]) => Promise<unknown[]>>(),
	findById: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	createFollowRelation: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	deleteFollowRelation: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	createBlockRelation: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	deleteBlockRelation: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	deleteMutualFollows: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	searchUsers: jest.fn<(...args: unknown[]) => Promise<unknown[]>>(),
};

const mockRedis = {
	get: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	set: jest.fn<(...args: unknown[]) => Promise<void>>(),
	del: jest.fn<(...args: unknown[]) => Promise<void>>(),
	delPattern: jest.fn<(...args: unknown[]) => Promise<void>>(),
};

const mockSendInternalNotification =
	jest.fn<(...args: unknown[]) => Promise<unknown>>();

// Isolate ES Modules prior to test environment execution
await jest.unstable_mockModule("../../../src/repositories/index.js", () => ({
	userRepository: mockUserRepository,
}));
await jest.unstable_mockModule("../../../src/utils/redis.js", () => ({
	redis: mockRedis,
}));
await jest.unstable_mockModule(
	"../../../src/services/notification.service.js",
	() => ({ sendInternalNotification: mockSendInternalNotification }),
);

// Resolve targeted operations under testing
const {
	getUserProfileByUsername,
	getUserPostsByUsername,
	getUserCommentsByUsername,
	followUserAction,
	unfollowUserAction,
	blockUserAction,
	unblockUserAction,
	searchForUsers,
} = await import("../../../src/services/user.service.js");

describe("User Service Unit Test Suite", () => {
	describe("getUserProfileByUsername", () => {
		it("Cache Hit Path: should resolve profile records instantly from storage layers", async () => {
			mockRedis.get.mockReset();
			mockUserRepository.findByUsername.mockReset();

			const cachedData = { id: "usr_1", username: "alex" };
			mockRedis.get.mockResolvedValue(cachedData);
			mockUserRepository.checkFollowRelation.mockResolvedValue(true);

			const result = await getUserProfileByUsername("alex", "usr_viewer");

			expect(mockRedis.get).toHaveBeenCalledWith(
				"profile:username:alex:profile",
			);
			expect(mockUserRepository.findByUsername).not.toHaveBeenCalled();
			expect(result).toEqual({ ...cachedData, isFollowing: true });
		});

		it("Business Rule (Not Found): should bubble up a 404 AppError if the target profile identity is missing", async () => {
			mockRedis.get.mockReset();
			mockUserRepository.findByUsername.mockReset();

			mockRedis.get.mockResolvedValue(null);
			mockUserRepository.findByUsername.mockResolvedValue(null);

			await expect(getUserProfileByUsername("missing_user")).rejects.toThrow(
				new AppError("Target user not found", 404),
			);
		});

		it("Business Rule (Block Suppression): should drop access silently with a clear 404 when block relations exist", async () => {
			mockRedis.get.mockReset();
			mockUserRepository.findByUsername.mockReset();
			mockUserRepository.checkBlockRelation.mockReset();

			mockRedis.get.mockResolvedValue(null);
			mockUserRepository.findByUsername.mockResolvedValue({
				id: "usr_blocked_target",
			});
			mockUserRepository.findProfileWithCounters.mockResolvedValue({
				id: "usr_blocked_target",
			});
			mockUserRepository.checkBlockRelation.mockResolvedValue(true);

			await expect(
				getUserProfileByUsername("blocked_user", "usr_viewer"),
			).rejects.toThrow(new AppError("Profile unavailable", 404));

			expect(mockUserRepository.checkBlockRelation).toHaveBeenCalledWith(
				"usr_viewer",
				"usr_blocked_target",
			);
		});

		it("Business Rule (Profile Data Missing Error): should throw a 404 if profile stats collection layers fail", async () => {
			mockRedis.get.mockReset();
			mockUserRepository.findByUsername.mockReset();
			mockUserRepository.checkBlockRelation.mockReset();
			mockUserRepository.findProfileWithCounters.mockReset();

			mockRedis.get.mockResolvedValue(null);
			mockUserRepository.findByUsername.mockResolvedValue({ id: "usr_target" });
			mockUserRepository.checkBlockRelation.mockResolvedValue(false);
			mockUserRepository.findProfileWithCounters.mockResolvedValue(null);

			await expect(
				getUserProfileByUsername("target_user", "usr_viewer"),
			).rejects.toThrow(
				new AppError("User profile data could not be retrieved", 404),
			);
		});

		it("Happy Path: should collect base counters and assert relationship statuses under full cache misses", async () => {
			mockRedis.get.mockReset();
			mockRedis.set.mockReset();
			mockUserRepository.findByUsername.mockReset();
			mockUserRepository.checkBlockRelation.mockReset();
			mockUserRepository.findProfileWithCounters.mockReset();
			mockUserRepository.checkFollowRelation.mockReset();

			mockRedis.get.mockResolvedValue(null);
			mockUserRepository.findByUsername.mockResolvedValue({ id: "usr_target" });
			mockUserRepository.checkBlockRelation.mockResolvedValue(false);

			const rawProfile = { id: "usr_target", bio: "Engineering lead" };
			mockUserRepository.findProfileWithCounters.mockResolvedValue(rawProfile);
			mockUserRepository.checkFollowRelation.mockResolvedValue({
				followActive: true,
			});

			const result = await getUserProfileByUsername(
				"target_user",
				"usr_viewer",
			);

			expect(mockRedis.set).toHaveBeenCalledWith(
				"profile:username:target_user:profile",
				rawProfile,
				3600,
			);
			expect(result).toEqual({ ...rawProfile, isFollowing: true });
		});
	});

	describe("getUserPostsByUsername", () => {
		it("Cache Hit Path: should serve author posts records immediately from cache layers", async () => {
			mockRedis.get.mockReset();
			mockUserRepository.findByUsername.mockReset();

			const cachedPosts = [{ id: "post_1", title: "Cache Patterns" }];
			mockRedis.get.mockResolvedValue(cachedPosts);

			const result = await getUserPostsByUsername("dan");

			expect(mockRedis.get).toHaveBeenCalledWith("profile:username:dan:posts");
			expect(mockUserRepository.findByUsername).not.toHaveBeenCalled();
			expect(result).toEqual(cachedPosts);
		});

		it("Happy Path: should extract author post logs from structural queries upon cache misses", async () => {
			mockRedis.get.mockReset();
			mockRedis.set.mockReset();
			mockUserRepository.findByUsername.mockReset();
			mockUserRepository.findPostsByAuthorId.mockReset();

			mockRedis.get.mockResolvedValue(null);
			mockUserRepository.findByUsername.mockResolvedValue({ id: "usr_dan" });

			const databasePosts = [{ id: "post_78", content: "Architecture docs" }];
			mockUserRepository.findPostsByAuthorId.mockResolvedValue(databasePosts);

			const result = await getUserPostsByUsername("dan");

			expect(mockUserRepository.findPostsByAuthorId).toHaveBeenCalledWith(
				"usr_dan",
			);
			expect(mockRedis.set).toHaveBeenCalledWith(
				"profile:username:dan:posts",
				databasePosts,
				1800,
			);
			expect(result).toEqual(databasePosts);
		});
	});

	describe("getUserCommentsByUsername", () => {
		it("Cache Hit Path: should yield historical comments data pools from cached states instantly", async () => {
			mockRedis.get.mockReset();
			mockUserRepository.findByUsername.mockReset();

			const cachedComments = [{ id: "cmt_12", text: "Agreed." }];
			mockRedis.get.mockResolvedValue(cachedComments);

			const result = await getUserCommentsByUsername("sophie");

			expect(mockRedis.get).toHaveBeenCalledWith(
				"profile:username:sophie:comments",
			);
			expect(result).toEqual(cachedComments);
		});

		it("Happy Path: should execute fallback profile lookups and fill storage spaces when empty", async () => {
			mockRedis.get.mockReset();
			mockRedis.set.mockReset();
			mockUserRepository.findByUsername.mockReset();
			mockUserRepository.findCommentsByAuthorId.mockReset();

			mockRedis.get.mockResolvedValue(null);
			mockUserRepository.findByUsername.mockResolvedValue({ id: "usr_sophie" });

			const dbComments = [{ id: "cmt_99", text: "Deep architectural dive." }];
			mockUserRepository.findCommentsByAuthorId.mockResolvedValue(dbComments);

			const result = await getUserCommentsByUsername("sophie");

			expect(mockUserRepository.findCommentsByAuthorId).toHaveBeenCalledWith(
				"usr_sophie",
			);
			expect(mockRedis.set).toHaveBeenCalledWith(
				"profile:username:sophie:comments",
				dbComments,
				1800,
			);
			expect(result).toEqual(dbComments);
		});
	});

	describe("followUserAction", () => {
		it("Business Rule (Self Action Validation): should stop self-following attempts with a 400 AppError", async () => {
			mockUserRepository.findByUsername.mockReset();
			mockUserRepository.findByUsername.mockResolvedValue({
				id: "usr_same_id",
			});

			await expect(followUserAction("usr_same_id", "myself")).rejects.toThrow(
				new AppError("You cannot follow yourself", 400),
			);
		});

		it("Happy Path: should configure follow relationships and drop cached index patterns entirely", async () => {
			mockUserRepository.findByUsername.mockReset();
			mockUserRepository.createFollowRelation.mockReset();
			mockUserRepository.findById.mockReset();
			mockRedis.del.mockReset();

			mockUserRepository.findByUsername.mockResolvedValue({
				id: "usr_target_id",
			});
			mockUserRepository.findById.mockResolvedValue({
				username: "follower_user",
			});
			mockUserRepository.findById.mockResolvedValue({
				username: "follower_user",
			});

			await followUserAction("usr_follower_id", "target_user");

			expect(mockUserRepository.createFollowRelation).toHaveBeenCalledWith(
				"usr_follower_id",
				"usr_target_id",
			);
			expect(mockRedis.del).toHaveBeenCalledWith([
				"profile:username:target_user:profile",
				"profile:username:follower_user:profile",
			]);
		});
	});

	describe("unfollowUserAction", () => {
		it("Happy Path: should strip follow definitions from storage records and drop dirty validation patterns", async () => {
			mockUserRepository.findByUsername.mockReset();
			mockUserRepository.deleteFollowRelation.mockReset();
			mockUserRepository.findById.mockReset();
			mockRedis.del.mockReset();

			mockUserRepository.findByUsername.mockResolvedValue({
				id: "usr_target_id",
			});
			mockUserRepository.findById.mockResolvedValue({
				username: "unfollower_user",
			});
			mockUserRepository.findById.mockResolvedValue({
				username: "unfollower_user",
			});

			await unfollowUserAction("usr_unfollower_id", "target_user");

			expect(mockUserRepository.deleteFollowRelation).toHaveBeenCalledWith(
				"usr_unfollower_id",
				"usr_target_id",
			);
			expect(mockRedis.del).toHaveBeenCalledWith([
				"profile:username:target_user:profile",
				"profile:username:unfollower_user:profile",
			]);
		});
	});

	describe("blockUserAction", () => {
		it("Business Rule (Self Action Validation): should reject self-blocking attempts with a 400 AppError", async () => {
			mockUserRepository.findByUsername.mockReset();
			mockUserRepository.findByUsername.mockResolvedValue({ id: "usr_self" });

			await expect(blockUserAction("usr_self", "myself")).rejects.toThrow(
				new AppError("You cannot block yourself", 400),
			);
		});

		it("Happy Path: should execute mutual breaks, save blocks, and thoroughly strip network caches", async () => {
			mockUserRepository.findByUsername.mockReset();
			mockUserRepository.deleteMutualFollows.mockReset();
			mockUserRepository.createBlockRelation.mockReset();
			mockUserRepository.findById.mockReset();
			mockRedis.del.mockReset();

			mockUserRepository.findByUsername.mockResolvedValue({ id: "usr_toxic" });
			mockUserRepository.findById.mockResolvedValue({
				username: "victim_user",
			});
			mockUserRepository.findById.mockResolvedValue({
				username: "victim_user",
			});

			await blockUserAction("usr_victim", "toxic_user");

			expect(mockUserRepository.deleteMutualFollows).toHaveBeenCalledWith(
				"usr_victim",
				"usr_toxic",
			);
			expect(mockUserRepository.createBlockRelation).toHaveBeenCalledWith(
				"usr_victim",
				"usr_toxic",
			);
			expect(mockRedis.del).toHaveBeenCalledWith([
				"profile:username:toxic_user:profile",
				"profile:username:victim_user:profile",
			]);
		});
	});

	describe("unblockUserAction", () => {
		it("Happy Path: should dissolve block records and refresh targeted profile paths completely", async () => {
			mockUserRepository.findByUsername.mockReset();
			mockUserRepository.deleteBlockRelation.mockReset();
			mockUserRepository.findById.mockReset();
			mockRedis.del.mockReset();

			mockUserRepository.findByUsername.mockResolvedValue({
				id: "usr_blocked",
			});
			mockUserRepository.findById.mockResolvedValue({
				username: "merciful_user",
			});
			mockUserRepository.findById.mockResolvedValue({
				username: "merciful_user",
			});

			await unblockUserAction("usr_merciful", "blocked_user");

			expect(mockUserRepository.deleteBlockRelation).toHaveBeenCalledWith(
				"usr_merciful",
				"usr_blocked",
			);
			expect(mockRedis.del).toHaveBeenCalledWith([
				"profile:username:blocked_user:profile",
				"profile:username:merciful_user:profile",
			]);
		});
	});

	describe("searchForUsers", () => {
		it("Cache Hit Path: should resolve matching indices immediately from localized tracking systems", async () => {
			mockRedis.get.mockReset();
			mockUserRepository.searchUsers.mockReset();

			const cachedResults = [{ id: "usr_10", username: "search_hit" }];
			mockRedis.get.mockResolvedValue(cachedResults);

			const result = await searchForUsers({ query: "  TEST_user  ", limit: 5 });

			expect(mockRedis.get).toHaveBeenCalledWith(
				"search:users:test_user:limit:5",
			);
			expect(mockUserRepository.searchUsers).not.toHaveBeenCalled();
			expect(result).toEqual(cachedResults);
		});

		it("Cache Miss Path: should issue standard database search calls and save hits to structural stores", async () => {
			mockRedis.get.mockReset();
			mockRedis.set.mockReset();
			mockUserRepository.searchUsers.mockReset();

			mockRedis.get.mockResolvedValue(null);
			const databaseHits = [
				{
					id: "usr_20",
					username: "db_hit",
					_count: {
						following: 12,
						followers: 340,
						posts: 57,
						ownedCommunities: 2,
					},
				},
			];
			mockUserRepository.searchUsers.mockResolvedValue(databaseHits);

			const result = await searchForUsers({ query: "Feynman", limit: 10 });

			expect(mockUserRepository.searchUsers).toHaveBeenCalledWith(
				"Feynman",
				10,
			);
			expect(mockRedis.set).toHaveBeenCalledWith(
				"search:users:feynman:limit:10",
				databaseHits,
				300,
			);
			expect(result).toEqual(databaseHits);
		});
	});
});
