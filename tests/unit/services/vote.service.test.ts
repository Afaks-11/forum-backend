import { describe, expect, it, jest } from "@jest/globals";
import { AppError } from "../../../src/errors/AppError.js";

// Module Level Infrastructure Mocks typed safely using 'unknown'
const mockPostRepository = {
	findById: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
};

const mockVoteRepository = {
	findUniqueVote: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	createVote: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	updateVote: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	deleteVote: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
};

const mockRedis = {
	delPattern: jest.fn<(...args: unknown[]) => Promise<void>>(),
};

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

// Resolve targeted operations under testing
const { castVote } = await import("../../../src/services/vote.service.js");

describe("Vote Service Unit Test Suite", () => {
	describe("castVote", () => {
		it("Business Rule (Post Not Found): should reject execution with a 404 AppError if target post metadata is missing", async () => {
			mockPostRepository.findById.mockReset();
			mockPostRepository.findById.mockResolvedValue(null);

			// `toThrow(new Error(...))` compares only the message, so it stayed green
			// after the service switched to AppError. Assert the type and status code
			// too — the HTTP status is the contract the error handler depends on.
			await expect(
				castVote({ postId: "missing_post_id", type: "UPVOTE" }, "usr_123"),
			).rejects.toThrow(new AppError("Post not found", 404));

			await expect(
				castVote({ postId: "missing_post_id", type: "UPVOTE" }, "usr_123"),
			).rejects.toMatchObject({ statusCode: 404 });

			expect(mockPostRepository.findById).toHaveBeenCalledWith(
				"missing_post_id",
			);
		});

		it("Happy Path (Vote Retraction / Removal): should delete an existing vote if the user submits an identical vote type", async () => {
			mockPostRepository.findById.mockReset();
			mockVoteRepository.findUniqueVote.mockReset();
			mockVoteRepository.deleteVote.mockReset();

			mockPostRepository.findById.mockResolvedValue({ id: "post_123" });

			const existingVoteRecord = {
				id: "vt_777",
				postId: "post_123",
				userId: "usr_123",
				type: "UPVOTE",
			};
			mockVoteRepository.findUniqueVote.mockResolvedValue(existingVoteRecord);
			mockVoteRepository.deleteVote.mockResolvedValue(existingVoteRecord);

			const result = await castVote(
				{ postId: "post_123", type: "UPVOTE" },
				"usr_123",
			);

			expect(mockVoteRepository.findUniqueVote).toHaveBeenCalledWith(
				"usr_123",
				"post_123",
			);
			expect(mockVoteRepository.deleteVote).toHaveBeenCalledWith("vt_777");
			expect(result).toEqual({ action: "REMOVED" });
			// The tally changed, so every viewer's cached copy of the metrics for
			// this post must be dropped. `getPostVoteMetrics` keys the cache per
			// viewer, hence the wildcard rather than a single del.
			expect(mockRedis.delPattern).toHaveBeenCalledWith(
				"post:post_123:vote_metrics:*",
			);
		});

		it("Happy Path (Vote Transition / Modification): should update the existing registry entry if types flip", async () => {
			mockPostRepository.findById.mockReset();
			mockVoteRepository.findUniqueVote.mockReset();
			mockVoteRepository.updateVote.mockReset();

			mockPostRepository.findById.mockResolvedValue({ id: "post_123" });

			const staleVoteRecord = {
				id: "vt_777",
				postId: "post_123",
				userId: "usr_123",
				type: "UPVOTE",
			};
			mockVoteRepository.findUniqueVote.mockResolvedValue(staleVoteRecord);

			const freshlyUpdatedRecord = {
				id: "vt_777",
				postId: "post_123",
				userId: "usr_123",
				type: "DOWNVOTE",
			};
			mockVoteRepository.updateVote.mockResolvedValue(freshlyUpdatedRecord);

			const result = await castVote(
				{ postId: "post_123", type: "DOWNVOTE" },
				"usr_123",
			);

			expect(mockVoteRepository.updateVote).toHaveBeenCalledWith(
				"vt_777",
				"DOWNVOTE",
			);
			expect(result).toEqual({ action: "CHANGED", vote: freshlyUpdatedRecord });
			expect(mockRedis.delPattern).toHaveBeenCalledWith(
				"post:post_123:vote_metrics:*",
			);
		});

		it("Happy Path (Fresh Registration / Generation): should instantiate a new vote if no interaction footprints are found", async () => {
			mockPostRepository.findById.mockReset();
			mockVoteRepository.findUniqueVote.mockReset();
			mockVoteRepository.createVote.mockReset();

			mockPostRepository.findById.mockResolvedValue({ id: "post_123" });
			mockVoteRepository.findUniqueVote.mockResolvedValue(null);

			const brandNewVoteRecord = {
				id: "vt_888",
				postId: "post_123",
				userId: "usr_123",
				type: "UPVOTE",
			};
			mockVoteRepository.createVote.mockResolvedValue(brandNewVoteRecord);

			const result = await castVote(
				{ postId: "post_123", type: "UPVOTE" },
				"usr_123",
			);

			expect(mockVoteRepository.createVote).toHaveBeenCalledWith({
				userId: "usr_123",
				postId: "post_123",
				type: "UPVOTE",
			});
			expect(result).toEqual({ action: "CREATED", vote: brandNewVoteRecord });
			expect(mockRedis.delPattern).toHaveBeenCalledWith(
				"post:post_123:vote_metrics:*",
			);
		});
	});
});
