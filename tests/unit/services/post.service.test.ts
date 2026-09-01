import { describe, expect, it, jest } from "@jest/globals";
import { AppError } from "../../../src/errors/AppError.js";

// Module Level Repository and Core Subsystem Mocks
const mockCommunityRepository = {
	findById: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	findMembership: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
};

const mockUserRepository = {
	findById: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
};

const mockPostRepository = {
	create: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	findById: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	findUniqueById: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	update: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	softDelete: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	getAdvancedFeed: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	save: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	unsave: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	updateLockStatus: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	updatePinStatus: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	findByIdWithViewerVote: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	findViewerVotes: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	searchPosts: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
};

const mockReportRepository = {
	create: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
};

const mockRedis = {
	get: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	set: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	del: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	delPattern: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
};

const mockSendInternalNotification =
	jest.fn<(...args: unknown[]) => Promise<unknown>>();

// Isolate ES Modules prior to execution boundaries
await jest.unstable_mockModule("../../../src/repositories/index.js", () => ({
	communityRepository: mockCommunityRepository,
	userRepository: mockUserRepository,
	postRepository: mockPostRepository,
	reportRepository: mockReportRepository,
}));
await jest.unstable_mockModule("../../../src/utils/redis.js", () => ({
	redis: mockRedis,
}));
await jest.unstable_mockModule(
	"../../../src/services/notification.service.js",
	() => ({
		sendInternalNotification: mockSendInternalNotification,
	}),
);

// Resolve targeted operations under testing
const {
	createPost,
	getPostById,
	updatePostFields,
	softDeletePost,
	savePostAction,
	modifyPostModerationState,
	getPostVoteMetrics,
	searchForPosts,
} = await import("../../../src/services/post.service.js");
const { getAdvancedPostsFeed } = await import(
	"../../../src/services/feed.service.js"
);

const { createFakePost, createFakeCommunityPayload } = await import(
	"../../fixtures/post.fixture.js"
);

describe("Post Service Unit Test Suite", () => {
	describe("createPost", () => {
		it("Happy Path: should successfully instantiate post parameters and wipe target feed indexes", async () => {
			const input = {
				communityId: "cmnt_123",
				title: "Architecture",
				content: "Body text",
				type: "TEXT" as const,
			};
			const fakeCommunity = createFakeCommunityPayload({ slug: "typescript" });
			const fakePost = createFakePost();

			mockCommunityRepository.findById.mockResolvedValue(fakeCommunity);
			mockPostRepository.create.mockResolvedValue(fakePost);

			const result = await createPost(input, "usr_123");

			expect(mockCommunityRepository.findById).toHaveBeenCalledWith("cmnt_123");
			expect(mockPostRepository.create).toHaveBeenCalledWith(input, "usr_123");
			expect(mockRedis.delPattern).toHaveBeenCalledWith("feed:advanced:*");
			expect(mockRedis.del).toHaveBeenCalledWith("feed:community:typescript");
			expect(result).toEqual(fakePost);
		});

		it("Business Rule: should throw 404 AppError if targeted community workspace is missing", async () => {
			mockCommunityRepository.findById.mockResolvedValue(null);

			await expect(
				createPost(
					{
						communityId: "missing_id",
						title: "Fail",
						content: "Fail",
						type: "TEXT" as const,
					},
					"usr_123",
				),
			).rejects.toThrow(new AppError("Target community not found", 404));
		});
	});

	describe("getPostById", () => {
		it("Happy Path (Cache Hit): should fetch directly from memory context without hitting database layer", async () => {
			const cachedPost = createFakePost();
			mockRedis.get.mockResolvedValue(cachedPost);

			const result = await getPostById("post_123");

			expect(mockRedis.get).toHaveBeenCalledWith("post:post_123");
			expect(mockPostRepository.findById).not.toHaveBeenCalled();
			expect(result).toEqual(cachedPost);
		});

		it("Happy Path (Cache Miss): should execute repository lookup and pop cache indexes on cold results", async () => {
			const dbPost = createFakePost();
			mockRedis.get.mockResolvedValue(null);
			mockPostRepository.findById.mockResolvedValue(dbPost);

			const result = await getPostById("post_123");

			expect(mockPostRepository.findById).toHaveBeenCalledWith("post_123");
			expect(mockRedis.set).toHaveBeenCalledWith("post:post_123", dbPost, 3600);
			expect(result).toEqual(dbPost);
		});

		it("Edge Case (Not Found): should raise 404 AppError if lookup record cannot be found or is soft deleted", async () => {
			mockRedis.get.mockResolvedValue(null);
			mockPostRepository.findById.mockResolvedValue(null);

			await expect(getPostById("missing_post")).rejects.toThrow(
				new AppError("Post not found or has been removed", 404),
			);
		});
	});

	describe("updatePostFields", () => {
		it("Happy Path: should complete partial delta applications if requested by original post author", async () => {
			const initialPost = createFakePost({ authorId: "usr_owner" });
			const patchPayload = { title: "Updated Title" };
			mockPostRepository.findUniqueById.mockResolvedValue(initialPost);
			mockPostRepository.update.mockResolvedValue({
				...initialPost,
				title: "Updated Title",
			});

			const result = await updatePostFields(
				"post_123",
				"usr_owner",
				patchPayload,
			);

			expect(mockPostRepository.update).toHaveBeenCalledWith("post_123", {
				title: "Updated Title",
			});
			expect(mockRedis.del).toHaveBeenCalledWith([
				"post:post_123",
				"post:post_123:vote_tally",
			]);
			expect(mockRedis.delPattern).toHaveBeenCalledWith("feed:advanced:*");
			expect(mockRedis.delPattern).toHaveBeenCalledWith("feed:community:*");
			expect(result.title).toBe("Updated Title");
		});

		it("Business Rule (Not Found): should throw 404 AppError if targeted entity possesses active deletedAt stamp", async () => {
			mockPostRepository.findUniqueById.mockResolvedValue(
				createFakePost({ deletedAt: new Date() }),
			);

			await expect(
				updatePostFields("post_123", "usr_owner", { title: "Edit" }),
			).rejects.toThrow(new AppError("Post not found", 404));
		});

		it("Business Rule (Forbidden): should reject operation with 403 AppError if sender matches wrong user footprint", async () => {
			mockPostRepository.findUniqueById.mockResolvedValue(
				createFakePost({ authorId: "usr_owner" }),
			);

			await expect(
				updatePostFields("post_123", "usr_imposter", { title: "Edit" }),
			).rejects.toThrow(
				new AppError("Forbidden: You do not own this post", 403),
			);
		});
	});

	describe("softDeletePost", () => {
		it("Happy Path: should confirm ownership before issuing safe deletion workflow and dusting structural keys", async () => {
			mockPostRepository.findUniqueById.mockResolvedValue(
				createFakePost({ authorId: "usr_owner" }),
			);
			mockPostRepository.softDelete.mockResolvedValue({
				id: "post_123",
				deletedAt: new Date(),
			});

			await softDeletePost("post_123", "usr_owner");

			expect(mockPostRepository.softDelete).toHaveBeenCalledWith("post_123");
			expect(mockRedis.del).toHaveBeenCalledWith([
				"post:post_123",
				"post:post_123:vote_tally",
			]);
			expect(mockRedis.delPattern).toHaveBeenCalledWith("feed:advanced:*");
			expect(mockRedis.delPattern).toHaveBeenCalledWith("feed:community:*");
		});

		it("Business Rule (Unauthorized): should block soft deletion if validation mapping context triggers identity mismatches", async () => {
			mockPostRepository.findUniqueById.mockResolvedValue(
				createFakePost({ authorId: "usr_owner" }),
			);

			await expect(softDeletePost("post_123", "usr_intruder")).rejects.toThrow(
				new AppError("Unauthorized to delete this post", 403),
			);
		});
	});

	describe("getAdvancedPostsFeed", () => {
		it("Happy Path: should evaluate complex filter scopes and populate high efficiency search buffers", async () => {
			const filterSchema = { sort: "hot" as const, community: "typescript" };
			mockRedis.get.mockResolvedValue(null);
			mockPostRepository.getAdvancedFeed.mockResolvedValue({
				posts: [],
				nextCursor: null,
			});

			await getAdvancedPostsFeed(filterSchema);

			const repositoryFilters = {
				sort: filterSchema.sort,
				limit: 10,
				community: filterSchema.community,
			};
			const predictableHash = Buffer.from(
				JSON.stringify(repositoryFilters),
			).toString("base64");
			expect(mockRedis.get).toHaveBeenCalledWith(
				`feed:advanced:${predictableHash}`,
			);
			expect(mockPostRepository.getAdvancedFeed).toHaveBeenCalledWith(
				repositoryFilters,
			);
			expect(mockRedis.set).toHaveBeenCalledWith(
				`feed:advanced:${predictableHash}`,
				{ posts: [], nextCursor: null },
				300,
			);
		});
	});

	describe("savePostAction", () => {
		it("Happy Path: should invoke save persistence engine under SAVE action parameters", async () => {
			mockPostRepository.findUniqueById.mockResolvedValue(createFakePost());

			await savePostAction("post_123", "usr_123", "SAVE");

			expect(mockPostRepository.save).toHaveBeenCalledWith(
				"post_123",
				"usr_123",
			);
			expect(mockPostRepository.unsave).not.toHaveBeenCalled();
		});

		it("Happy Path: should invoke unsave persistence engine under UNSAVE action parameters", async () => {
			mockPostRepository.findUniqueById.mockResolvedValue(createFakePost());

			await savePostAction("post_123", "usr_123", "UNSAVE");

			expect(mockPostRepository.unsave).toHaveBeenCalledWith(
				"post_123",
				"usr_123",
			);
			expect(mockPostRepository.save).not.toHaveBeenCalled();
		});
	});

	describe("modifyPostModerationState", () => {
		describe("Action: LOCK", () => {
			it("Happy Path (Owner Context): should allow post creator to toggle standard lock parameters", async () => {
				const post = createFakePost({ authorId: "usr_owner", title: "Hello" });
				mockPostRepository.findUniqueById.mockResolvedValue(post);
				mockUserRepository.findById.mockResolvedValue({ role: "USER" });

				await modifyPostModerationState("post_123", "usr_owner", {
					action: "LOCK",
					isLocked: true,
				});

				expect(mockPostRepository.updateLockStatus).toHaveBeenCalledWith(
					"post_123",
					true,
					"usr_owner",
				);
				expect(mockRedis.del).toHaveBeenCalledWith([
					"post:post_123",
					"post:post_123:vote_tally",
				]);
				expect(mockSendInternalNotification).not.toHaveBeenCalled();
			});

			it("Happy Path (Staff Context): should authorize non-owner accounts if they maintain staff privileges", async () => {
				const post = createFakePost({ authorId: "usr_owner" });
				mockPostRepository.findUniqueById.mockResolvedValue(post);
				mockUserRepository.findById.mockResolvedValue({ role: "USER" });
				mockCommunityRepository.findMembership.mockResolvedValue({
					role: "MODERATOR",
				});

				await modifyPostModerationState("post_123", "usr_staff", {
					action: "LOCK",
					isLocked: true,
				});

				expect(mockPostRepository.updateLockStatus).toHaveBeenCalledWith(
					"post_123",
					true,
					"usr_staff",
				);
			});

			it("Business Rule (Unauthorized): should block lock alteration requests from unaffiliated system accounts", async () => {
				const post = createFakePost({ authorId: "usr_owner" });
				mockPostRepository.findUniqueById.mockResolvedValue(post);
				mockUserRepository.findById.mockResolvedValue({ role: "USER" });

				await expect(
					modifyPostModerationState("post_123", "usr_random", {
						action: "LOCK",
						isLocked: true,
					}),
				).rejects.toThrow(
					new AppError("Forbidden: insufficient privileges", 403),
				);
			});
		});

		describe("Action: PIN", () => {
			it("Happy Path: should execute internal visibility alterations and drop matching search cache contexts", async () => {
				mockPostRepository.findUniqueById.mockResolvedValue(createFakePost());
				mockUserRepository.findById.mockResolvedValue({ role: "ADMIN" });

				await modifyPostModerationState("post_123", "usr_admin", {
					action: "PIN",
					isPinned: true,
				});

				expect(mockPostRepository.updatePinStatus).toHaveBeenCalledWith(
					"post_123",
					true,
				);
				expect(mockRedis.del).toHaveBeenCalledWith([
					"post:post_123",
					"post:post_123:vote_tally",
				]);
				expect(mockRedis.delPattern).toHaveBeenCalledWith("feed:advanced:*");
			});

			it("Business Rule (Unauthorized): should refuse pinning for callers without moderation privileges, even post owners", async () => {
				mockPostRepository.findUniqueById.mockResolvedValue(
					createFakePost({ authorId: "usr_owner" }),
				);
				mockUserRepository.findById.mockResolvedValue({ role: "USER" });

				await expect(
					modifyPostModerationState("post_123", "usr_owner", {
						action: "PIN",
						isPinned: true,
					}),
				).rejects.toThrow(
					new AppError("Forbidden: Moderator privileges required", 403),
				);
				expect(mockPostRepository.updatePinStatus).not.toHaveBeenCalled();
			});
		});

		describe("Action: REPORT", () => {
			it("Happy Path: should forward report structures into moderation queues", async () => {
				mockPostRepository.findUniqueById.mockResolvedValue(createFakePost());

				await modifyPostModerationState("post_123", "usr_reporter", {
					action: "REPORT",
					reason: "Spam content",
				});

				expect(mockReportRepository.create).toHaveBeenCalledWith(
					"post_123",
					"usr_reporter",
					"Spam content",
				);
			});
		});

		describe("Action: HIDE", () => {
			it("Happy Path: should safely acknowledge user layer requested hides", async () => {
				mockPostRepository.findUniqueById.mockResolvedValue(createFakePost());

				const response = await modifyPostModerationState(
					"post_123",
					"usr_123",
					{ action: "HIDE" },
				);

				expect(response).toEqual({
					success: true,
					message: "Cached user-hide request processed",
				});
			});
		});
	});

	describe("getPostVoteMetrics", () => {
		it("Happy Path (Cache Hit): should fetch vote counts from fast cache layers", async () => {
			const scorePayload = {
				upvoteCount: 10,
				downvoteCount: 2,
				score: 8,
			};
			mockRedis.get.mockResolvedValue(scorePayload);
			mockPostRepository.findViewerVotes.mockResolvedValue(
				new Map([["post_123", "UPVOTE"]]),
			);

			const result = await getPostVoteMetrics("post_123", "usr_123");

			expect(mockRedis.get).toHaveBeenCalledWith("post:post_123:vote_tally");
			expect(result).toEqual({ ...scorePayload, currentUserVote: "UPVOTE" });
		});

		it("Happy Path (Cache Miss): should read stored counters and the viewer's own vote in a single query", async () => {
			mockRedis.get.mockResolvedValue(null);
			mockPostRepository.findByIdWithViewerVote.mockResolvedValue({
				id: "post_123",
				deletedAt: null,
				upvoteCount: 10,
				downvoteCount: 3,
				score: 7,
				votes: [{ type: "DOWNVOTE" }],
			});

			const result = await getPostVoteMetrics("post_123", "usr_123");

			expect(mockPostRepository.findByIdWithViewerVote).toHaveBeenCalledWith(
				"post_123",
				"usr_123",
			);
			expect(mockRedis.set).toHaveBeenCalledWith(
				"post:post_123:vote_tally",
				{
					upvoteCount: 10,
					downvoteCount: 3,
					score: 7,
				},
				60,
			);
			expect(result.score).toBe(7);
			expect(result.currentUserVote).toBe("DOWNVOTE");
		});

		it("should report a null currentUserVote when the viewer has not voted", async () => {
			mockRedis.get.mockResolvedValue(null);
			mockPostRepository.findByIdWithViewerVote.mockResolvedValue({
				id: "post_123",
				deletedAt: null,
				upvoteCount: 4,
				downvoteCount: 1,
				score: 3,
				votes: [],
			});

			const result = await getPostVoteMetrics("post_123", "usr_123");

			expect(result.currentUserVote).toBeNull();
			expect(result.score).toBe(3);
		});

		it("should reject a missing post rather than reporting zeroed counters", async () => {
			mockRedis.get.mockResolvedValue(null);
			mockPostRepository.findByIdWithViewerVote.mockResolvedValue(null);

			await expect(getPostVoteMetrics("post_404", "usr_123")).rejects.toThrow(
				new AppError("Post not found", 404),
			);
			expect(mockRedis.set).not.toHaveBeenCalled();
		});
	});

	describe("searchForPosts", () => {
		it("Happy Path: should normalize parameter variations and return queries bound to tight lifecycle bounds", async () => {
			const inputParams = {
				query: "  ARCHITECTURE  ",
				limit: 5,
				cursor: "post_099",
			};
			mockRedis.get.mockResolvedValue(null);
			mockPostRepository.searchPosts.mockResolvedValue({
				posts: [],
				nextCursor: null,
			});

			await searchForPosts(inputParams);

			expect(mockRedis.get).toHaveBeenCalledWith(
				"search:posts:architecture:limit:5:cursor:post_099",
			);
			expect(mockPostRepository.searchPosts).toHaveBeenCalledWith({
				query: "  ARCHITECTURE  ",
				limit: 5,
				cursor: "post_099",
			});
			expect(mockRedis.set).toHaveBeenCalledWith(
				"search:posts:architecture:limit:5:cursor:post_099",
				{ posts: [], nextCursor: null },
				180,
			);
		});
	});
});
