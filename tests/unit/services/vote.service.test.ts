import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { AppError } from "../../../src/errors/AppError.js";

// Module Level Infrastructure Mocks typed safely using 'unknown'
const mockPostRepository = {
	findUniqueById: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
};

const mockVoteRepository = {
	applyVote: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
};

const mockRedis = {
	del: jest.fn<(...args: unknown[]) => Promise<void>>(),
	delPattern: jest.fn<(...args: unknown[]) => Promise<void>>(),
};

const mockIsRetryableVoteConflict = jest.fn<(error: unknown) => boolean>();

// Isolate ES Modules prior to test environment execution
await jest.unstable_mockModule("../../../src/repositories/index.js", () => ({
	postRepository: mockPostRepository,
	voteRepository: mockVoteRepository,
}));
// Without this the real client module is loaded and opens a live ioredis
// connection during a unit run, which is the ECONNREFUSED/open-handle failure
// mode the other service suites already guard against.
await jest.unstable_mockModule("../../../src/utils/redis.js", () => ({
	redis: mockRedis,
}));
// The retry predicate inspects Prisma error codes, which cannot be produced
// from a plain mock rejection, so the predicate itself is stubbed here and
// exercised directly in the repository suite.
await jest.unstable_mockModule(
	"../../../src/repositories/vote.repository.js",
	() => ({
		isRetryableVoteConflict: mockIsRetryableVoteConflict,
	}),
);

// Resolve targeted operations under testing
const { castVote } = await import("../../../src/services/vote.service.js");

const livePost = { id: "post_123", deletedAt: null, isLocked: false };

describe("Vote Service Unit Test Suite", () => {
	beforeEach(() => {
		mockPostRepository.findUniqueById.mockReset();
		mockVoteRepository.applyVote.mockReset();
		mockRedis.del.mockReset();
		mockRedis.delPattern.mockReset();
		mockIsRetryableVoteConflict.mockReset();
		mockIsRetryableVoteConflict.mockReturnValue(false);
	});

	describe("castVote", () => {
		it("Business Rule (Post Not Found): should reject execution with a 404 AppError if target post metadata is missing", async () => {
			mockPostRepository.findUniqueById.mockResolvedValue(null);

			// `toThrow(new Error(...))` compares only the message, so it stayed green
			// after the service switched to AppError. Assert the type and status code
			// too — the HTTP status is the contract the error handler depends on.
			await expect(
				castVote({ postId: "missing_post_id", type: "UPVOTE" }, "usr_123"),
			).rejects.toThrow(new AppError("Post not found", 404));

			await expect(
				castVote({ postId: "missing_post_id", type: "UPVOTE" }, "usr_123"),
			).rejects.toMatchObject({ statusCode: 404 });

			expect(mockPostRepository.findUniqueById).toHaveBeenCalledWith(
				"missing_post_id",
			);
			expect(mockVoteRepository.applyVote).not.toHaveBeenCalled();
		});

		it("Business Rule (Soft-Deleted Post): should treat a soft-deleted post as absent", async () => {
			mockPostRepository.findUniqueById.mockResolvedValue({
				id: "post_123",
				deletedAt: new Date(),
				isLocked: false,
			});

			await expect(
				castVote({ postId: "post_123", type: "UPVOTE" }, "usr_123"),
			).rejects.toThrow(new AppError("Post not found", 404));

			expect(mockVoteRepository.applyVote).not.toHaveBeenCalled();
		});

		it("Business Rule (Locked Post): should refuse a vote on a locked post with a 403", async () => {
			mockPostRepository.findUniqueById.mockResolvedValue({
				id: "post_123",
				deletedAt: null,
				isLocked: true,
			});

			await expect(
				castVote({ postId: "post_123", type: "UPVOTE" }, "usr_123"),
			).rejects.toThrow(
				new AppError("Voting is disabled on a locked post", 403),
			);

			expect(mockVoteRepository.applyVote).not.toHaveBeenCalled();
			expect(mockRedis.delPattern).not.toHaveBeenCalled();
		});

		it("Happy Path (Fresh Registration): should forward a first-time vote and return the refreshed tallies", async () => {
			mockPostRepository.findUniqueById.mockResolvedValue(livePost);
			mockVoteRepository.applyVote.mockResolvedValue({
				action: "CREATED",
				score: 8,
				upvoteCount: 10,
				downvoteCount: 2,
				currentUserVote: "UPVOTE",
			});

			const result = await castVote(
				{ postId: "post_123", type: "UPVOTE" },
				"usr_123",
			);

			expect(mockVoteRepository.applyVote).toHaveBeenCalledWith(
				"usr_123",
				"post_123",
				"UPVOTE",
			);
			expect(result).toEqual({
				action: "CREATED",
				score: 8,
				upvoteCount: 10,
				downvoteCount: 2,
				currentUserVote: "UPVOTE",
			});
			expect(mockRedis.del).toHaveBeenCalledWith([
				"post:post_123",
				"post:post_123:vote_tally",
			]);
		});

		it("Happy Path (Vote Retraction): should surface a null currentUserVote once the vote is withdrawn", async () => {
			mockPostRepository.findUniqueById.mockResolvedValue(livePost);
			mockVoteRepository.applyVote.mockResolvedValue({
				action: "REMOVED",
				score: 7,
				upvoteCount: 9,
				downvoteCount: 2,
				currentUserVote: null,
			});

			const result = await castVote(
				{ postId: "post_123", type: "UPVOTE" },
				"usr_123",
			);

			expect(result.action).toBe("REMOVED");
			expect(result.currentUserVote).toBeNull();
			// The tally changed, so every viewer's cached copy of the metrics for
			// this post must be dropped. `getPostVoteMetrics` keys the cache per
			// viewer, hence the wildcard rather than a single del.
			expect(mockRedis.del).toHaveBeenCalledWith([
				"post:post_123",
				"post:post_123:vote_tally",
			]);
		});

		it("Happy Path (Vote Transition): should report the flipped side as the viewer's current vote", async () => {
			mockPostRepository.findUniqueById.mockResolvedValue(livePost);
			mockVoteRepository.applyVote.mockResolvedValue({
				action: "CHANGED",
				score: 6,
				upvoteCount: 9,
				downvoteCount: 3,
				currentUserVote: "DOWNVOTE",
			});

			const result = await castVote(
				{ postId: "post_123", type: "DOWNVOTE" },
				"usr_123",
			);

			expect(mockVoteRepository.applyVote).toHaveBeenCalledWith(
				"usr_123",
				"post_123",
				"DOWNVOTE",
			);
			expect(result.action).toBe("CHANGED");
			expect(result.currentUserVote).toBe("DOWNVOTE");
		});

		it("Concurrency: should retry once when two first votes race and one loses the insert", async () => {
			mockPostRepository.findUniqueById.mockResolvedValue(livePost);
			mockIsRetryableVoteConflict.mockReturnValue(true);

			const conflict = new Error("unique constraint violated");
			mockVoteRepository.applyVote
				.mockRejectedValueOnce(conflict)
				.mockResolvedValueOnce({
					action: "REMOVED",
					score: 1,
					upvoteCount: 1,
					downvoteCount: 0,
					currentUserVote: null,
				});

			const result = await castVote(
				{ postId: "post_123", type: "UPVOTE" },
				"usr_123",
			);

			expect(mockIsRetryableVoteConflict).toHaveBeenCalledWith(conflict);
			expect(mockVoteRepository.applyVote).toHaveBeenCalledTimes(2);
			expect(result.action).toBe("REMOVED");
		});

		it("Concurrency: should propagate a non-retryable failure without a second attempt", async () => {
			mockPostRepository.findUniqueById.mockResolvedValue(livePost);
			mockIsRetryableVoteConflict.mockReturnValue(false);

			const fatal = new Error("connection terminated");
			mockVoteRepository.applyVote.mockRejectedValue(fatal);

			await expect(
				castVote({ postId: "post_123", type: "UPVOTE" }, "usr_123"),
			).rejects.toThrow(fatal);

			expect(mockVoteRepository.applyVote).toHaveBeenCalledTimes(1);
			// A failed write must not evict a cache entry that still matches the
			// database, or readers pay a pointless recompute.
			expect(mockRedis.delPattern).not.toHaveBeenCalled();
		});
	});
});
