import { beforeAll, describe, expect, it } from "@jest/globals";
import type { Application } from "express";
import supertest from "supertest";
import { createUserWithPost, createVerifiedUser } from "../auth.helper.js";
import { getE2EDatabase } from "../test-db.js";
import { getE2EServer } from "../test-server.js";

describe("POST /api/v1/votes", () => {
	let app: Application;
	let db: ReturnType<typeof getE2EDatabase>;

	beforeAll(async () => {
		app = await getE2EServer();
		db = getE2EDatabase();
	});

	const castVote = (postId: string, token: string, type: string) =>
		supertest(app)
			.post("/api/v1/votes")
			.set("Authorization", `Bearer ${token}`)
			.send({ postId, type });

	describe("upvote", () => {
		it("records an upvote and persists it", async () => {
			const { postId } = await createUserWithPost(app);
			const voter = await createVerifiedUser(app);

			const res = await castVote(postId, voter.accessToken, "UPVOTE");

			expect(res.status).toBe(200);
			expect(res.body.success).toBe(true);
			expect(res.body.data).toEqual({
				action: "CREATED",
				score: 1,
				upvoteCount: 1,
				downvoteCount: 0,
				currentUserVote: "UPVOTE",
			});

			const stored = await db.vote.findUnique({
				where: { userId_postId: { userId: voter.id, postId } },
			});
			expect(stored).not.toBeNull();
			expect(stored?.type).toBe("UPVOTE");
		});

		it("reflects the upvote in the post vote metrics", async () => {
			const { postId } = await createUserWithPost(app);
			const voter = await createVerifiedUser(app);

			await castVote(postId, voter.accessToken, "UPVOTE");

			const res = await supertest(app)
				.get(`/api/v1/posts/${postId}/votes`)
				.set("Authorization", `Bearer ${voter.accessToken}`);

			expect(res.status).toBe(200);
			expect(res.body.data.upvoteCount).toBe(1);
			expect(res.body.data.downvoteCount).toBe(0);
			expect(res.body.data.score).toBe(1);
			expect(res.body.data.currentUserVote).toBe("UPVOTE");
		});
	});

	describe("downvote", () => {
		it("records a downvote and persists it", async () => {
			const { postId } = await createUserWithPost(app);
			const voter = await createVerifiedUser(app);

			const res = await castVote(postId, voter.accessToken, "DOWNVOTE");

			expect(res.status).toBe(200);
			expect(res.body.data).toEqual({
				action: "CREATED",
				score: -1,
				upvoteCount: 0,
				downvoteCount: 1,
				currentUserVote: "DOWNVOTE",
			});

			const stored = await db.vote.findUnique({
				where: { userId_postId: { userId: voter.id, postId } },
			});
			expect(stored?.type).toBe("DOWNVOTE");
		});

		it("switches an existing upvote to a downvote without duplicating rows", async () => {
			const { postId } = await createUserWithPost(app);
			const voter = await createVerifiedUser(app);

			await castVote(postId, voter.accessToken, "UPVOTE");
			const res = await castVote(postId, voter.accessToken, "DOWNVOTE");

			expect(res.status).toBe(200);
			// Both counters move in the same step, so a flip swings the score by
			// two rather than one.
			expect(res.body.data).toEqual({
				action: "CHANGED",
				score: -1,
				upvoteCount: 0,
				downvoteCount: 1,
				currentUserVote: "DOWNVOTE",
			});

			const votes = await db.vote.findMany({ where: { postId } });
			expect(votes).toHaveLength(1);
			expect(votes[0]?.type).toBe("DOWNVOTE");
		});
	});

	describe("remove vote", () => {
		it("removes the vote when the same type is cast twice", async () => {
			const { postId } = await createUserWithPost(app);
			const voter = await createVerifiedUser(app);

			await castVote(postId, voter.accessToken, "UPVOTE");
			const res = await castVote(postId, voter.accessToken, "UPVOTE");

			expect(res.status).toBe(200);
			expect(res.body.data).toEqual({
				action: "REMOVED",
				score: 0,
				upvoteCount: 0,
				downvoteCount: 0,
				currentUserVote: null,
			});

			const stored = await db.vote.findUnique({
				where: { userId_postId: { userId: voter.id, postId } },
			});
			expect(stored).toBeNull();
		});

		it("returns the post to a neutral score after removal", async () => {
			const { postId } = await createUserWithPost(app);
			const voter = await createVerifiedUser(app);

			await castVote(postId, voter.accessToken, "UPVOTE");
			await castVote(postId, voter.accessToken, "UPVOTE");

			const res = await supertest(app)
				.get(`/api/v1/posts/${postId}/votes`)
				.set("Authorization", `Bearer ${voter.accessToken}`);

			expect(res.body.data.score).toBe(0);
			expect(res.body.data.currentUserVote).toBeNull();
		});
	});

	describe("aggregation across voters", () => {
		it("computes score as upvotes minus downvotes", async () => {
			const { postId } = await createUserWithPost(app);
			const up = await createVerifiedUser(app);
			const down = await createVerifiedUser(app);

			await castVote(postId, up.accessToken, "UPVOTE");
			await castVote(postId, down.accessToken, "DOWNVOTE");

			const res = await supertest(app).get(`/api/v1/posts/${postId}/votes`);

			expect(res.body.data.upvoteCount).toBe(1);
			expect(res.body.data.downvoteCount).toBe(1);
			expect(res.body.data.score).toBe(0);
			// Anonymous readers have no vote of their own.
			expect(res.body.data.currentUserVote).toBeNull();
		});

		it("keeps the stored counters in step with the vote rows", async () => {
			const { postId } = await createUserWithPost(app);
			const first = await createVerifiedUser(app);
			const second = await createVerifiedUser(app);

			await castVote(postId, first.accessToken, "UPVOTE");
			await castVote(postId, second.accessToken, "UPVOTE");
			await castVote(postId, second.accessToken, "DOWNVOTE");

			const [post, votes] = await Promise.all([
				db.post.findUniqueOrThrow({ where: { id: postId } }),
				db.vote.findMany({ where: { postId } }),
			]);

			// The counters are denormalized, so the invariant worth guarding is that
			// they still agree with the votes table they were derived from.
			const upvotes = votes.filter((vote) => vote.type === "UPVOTE").length;
			const downvotes = votes.filter((vote) => vote.type === "DOWNVOTE").length;

			expect(post.upvoteCount).toBe(upvotes);
			expect(post.downvoteCount).toBe(downvotes);
			expect(post.score).toBe(upvotes - downvotes);
		});
	});

	describe("authorization and validation", () => {
		it("rejects unauthenticated votes", async () => {
			const { postId } = await createUserWithPost(app);

			const res = await supertest(app)
				.post("/api/v1/votes")
				.send({ postId, type: "UPVOTE" });

			expect(res.status).toBe(401);
			expect(res.body.success).toBe(false);
		});

		it("returns 404 for a post that does not exist", async () => {
			const voter = await createVerifiedUser(app);

			const res = await castVote(
				"00000000-0000-0000-0000-000000000000",
				voter.accessToken,
				"UPVOTE",
			);

			expect(res.status).toBe(404);
			expect(res.body.success).toBe(false);
		});

		it("rejects a malformed post id", async () => {
			const voter = await createVerifiedUser(app);

			const res = await castVote("not-a-uuid", voter.accessToken, "UPVOTE");

			expect(res.status).toBe(400);
			expect(res.body.success).toBe(false);
		});

		it("rejects an unsupported vote type", async () => {
			const { postId } = await createUserWithPost(app);
			const voter = await createVerifiedUser(app);

			const res = await castVote(postId, voter.accessToken, "SIDEVOTE");

			expect(res.status).toBe(400);
			expect(res.body.success).toBe(false);
		});

		it("refuses to vote on a locked post", async () => {
			const { postId } = await createUserWithPost(app);
			const voter = await createVerifiedUser(app);

			await db.post.update({
				where: { id: postId },
				data: { isLocked: true },
			});

			const res = await castVote(postId, voter.accessToken, "UPVOTE");

			expect(res.status).toBe(403);
			expect(res.body.success).toBe(false);

			const votes = await db.vote.findMany({ where: { postId } });
			expect(votes).toHaveLength(0);
		});
	});
});
