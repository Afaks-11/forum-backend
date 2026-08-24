import crypto from "node:crypto";
import { beforeAll, describe, expect, it } from "@jest/globals";
import supertest from "supertest";
import { voteRepository } from "../../src/repositories/index.js";
import { getTestApp } from "../helpers/app.js";
import { generateAccessToken } from "../helpers/auth.js";
import { getTestDatabase } from "../helpers/database.js";

let request: supertest.Agent;
let db: ReturnType<typeof getTestDatabase>;

beforeAll(async () => {
	const app = await getTestApp();
	request = supertest(app);
	db = getTestDatabase();
});

const createUser = () =>
	db.user.create({
		data: {
			id: crypto.randomUUID(),
			username: `u_${crypto.randomBytes(4).toString("hex")}`,
			email: `e_${crypto.randomBytes(4).toString("hex")}@t.com`,
			password: "$2b$10$abcdefghijklmnopqrstuvwxyzA1234567890FakeHash",
			isEmailVerified: true,
		},
	});

const createCommunity = (creatorId: string) =>
	db.community.create({
		data: {
			id: crypto.randomUUID(),
			name: `C_${crypto.randomBytes(4).toString("hex")}`,
			slug: `c_${crypto.randomBytes(4).toString("hex")}`,
			creatorId,
		},
	});

const createPost = (
	authorId: string,
	communityId: string,
	overrides: { isLocked?: boolean } = {},
) =>
	db.post.create({
		data: {
			title: "Test Post",
			content: "Test content",
			authorId,
			communityId,
			...overrides,
		},
	});

/**
 * Sets up an author, a community, a post and a bearer token in one call, since
 * every case below needs the same four.
 */
const seedVotablePost = async (overrides: { isLocked?: boolean } = {}) => {
	const user = await createUser();
	const community = await createCommunity(user.id);
	const post = await createPost(user.id, community.id, overrides);
	const token = await generateAccessToken(user.id);
	return { user, community, post, token };
};

const castVote = (postId: string, token: string, type: string) =>
	request
		.post("/api/v1/votes")
		.set("Authorization", `Bearer ${token}`)
		.send({ postId, type });

describe("POST /api/v1/votes", () => {
	it("should create an upvote and return the refreshed tallies", async () => {
		const { post, token } = await seedVotablePost();

		const res = await castVote(post.id, token, "UPVOTE");

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.data).toEqual({
			action: "CREATED",
			score: 1,
			upvoteCount: 1,
			downvoteCount: 0,
			currentUserVote: "UPVOTE",
		});
	});

	it("should persist the counters onto the post row, not just the response", async () => {
		const { post, token } = await seedVotablePost();

		await castVote(post.id, token, "UPVOTE");

		const stored = await db.post.findUniqueOrThrow({ where: { id: post.id } });
		expect(stored.upvoteCount).toBe(1);
		expect(stored.downvoteCount).toBe(0);
		expect(stored.score).toBe(1);
	});

	it("should remove vote when same type is sent again", async () => {
		const { post, token } = await seedVotablePost();

		await castVote(post.id, token, "UPVOTE");
		const res = await castVote(post.id, token, "UPVOTE");

		expect(res.status).toBe(200);
		expect(res.body.data).toEqual({
			action: "REMOVED",
			score: 0,
			upvoteCount: 0,
			downvoteCount: 0,
			currentUserVote: null,
		});
	});

	it("should change vote type and move both counters at once", async () => {
		const { post, token } = await seedVotablePost();

		await castVote(post.id, token, "UPVOTE");
		const res = await castVote(post.id, token, "DOWNVOTE");

		expect(res.status).toBe(200);
		// A flip is not an add — the upvote has to come back off in the same step,
		// otherwise the two counters drift apart by one on every switch.
		expect(res.body.data).toEqual({
			action: "CHANGED",
			score: -1,
			upvoteCount: 0,
			downvoteCount: 1,
			currentUserVote: "DOWNVOTE",
		});
	});

	it("should leave the vote row as the source of truth for the counters", async () => {
		const { post, token } = await seedVotablePost();

		await castVote(post.id, token, "UPVOTE");
		await castVote(post.id, token, "DOWNVOTE");

		const votes = await db.vote.findMany({ where: { postId: post.id } });
		expect(votes).toHaveLength(1);
		expect(votes[0]?.type).toBe("DOWNVOTE");
	});

	it("should reject a vote on a locked post with 403", async () => {
		const { post, token } = await seedVotablePost({ isLocked: true });

		const res = await castVote(post.id, token, "UPVOTE");

		expect(res.status).toBe(403);
		expect(res.body.success).toBe(false);

		const stored = await db.post.findUniqueOrThrow({ where: { id: post.id } });
		expect(stored.score).toBe(0);
	});

	it("should return 401 without auth", async () => {
		const res = await request
			.post("/api/v1/votes")
			.send({ postId: crypto.randomUUID(), type: "UPVOTE" });

		expect(res.status).toBe(401);
	});

	it("should return 400 for validation failure", async () => {
		const user = await createUser();
		const token = await generateAccessToken(user.id);

		const res = await request
			.post("/api/v1/votes")
			.set("Authorization", `Bearer ${token}`)
			.send({ postId: "bad-uuid", type: "INVALID" });

		expect(res.status).toBe(400);
		expect(res.body.success).toBe(false);
		expect(res.body.message).toBe("Validation failed");
		expect(Array.isArray(res.body.errors)).toBe(true);
	});

	it("should return 404 for non-existent post", async () => {
		const user = await createUser();
		const token = await generateAccessToken(user.id);

		const res = await request
			.post("/api/v1/votes")
			.set("Authorization", `Bearer ${token}`)
			.send({ postId: crypto.randomUUID(), type: "UPVOTE" });

		expect(res.status).toBe(404);
		expect(res.body.success).toBe(false);
	});
});

describe("POST /api/v1/votes concurrency", () => {
	it("should tally every vote when many distinct users vote at once", async () => {
		const { post } = await seedVotablePost();

		const voters = await Promise.all(
			Array.from({ length: 12 }, () => createUser()),
		);
		const tokens = await Promise.all(
			voters.map((voter) => generateAccessToken(voter.id)),
		);

		// Nine up, three down, all in flight together. Read-modify-write counters
		// lose updates here; a SQL-level increment inside the vote transaction
		// does not.
		const responses = await Promise.all(
			tokens.map((token, index) =>
				castVote(post.id, token, index < 9 ? "UPVOTE" : "DOWNVOTE"),
			),
		);

		for (const res of responses) {
			expect(res.status).toBe(200);
		}

		const stored = await db.post.findUniqueOrThrow({ where: { id: post.id } });
		expect(stored.upvoteCount).toBe(9);
		expect(stored.downvoteCount).toBe(3);
		expect(stored.score).toBe(6);
	});

	it("should keep counters consistent with the vote rows under a repeated toggle", async () => {
		const { post, token } = await seedVotablePost();

		// Sequential rather than parallel: the same user toggling is a logical
		// race the API resolves by last-write-wins, so the meaningful assertion
		// is that counters and rows agree once the dust settles.
		for (let i = 0; i < 7; i++) {
			await castVote(post.id, token, "UPVOTE");
		}

		const [stored, votes] = await Promise.all([
			db.post.findUniqueOrThrow({ where: { id: post.id } }),
			db.vote.findMany({ where: { postId: post.id } }),
		]);

		// An odd number of toggles leaves the vote standing.
		expect(votes).toHaveLength(1);
		expect(stored.upvoteCount).toBe(1);
		expect(stored.score).toBe(1);
	});

	it("should not double-count when one user fires duplicate votes simultaneously", async () => {
		const { post, token } = await seedVotablePost();

		await Promise.all([
			castVote(post.id, token, "UPVOTE"),
			castVote(post.id, token, "UPVOTE"),
		]);

		const [stored, votes] = await Promise.all([
			db.post.findUniqueOrThrow({ where: { id: post.id } }),
			db.vote.findMany({ where: { postId: post.id } }),
		]);

		// The unique (userId, postId) constraint means at most one row survives,
		// and the counter must agree with however the race settled.
		expect(votes.length).toBeLessThanOrEqual(1);
		expect(stored.upvoteCount).toBe(votes.length);
		expect(stored.score).toBe(votes.length);
	});

	it("should rebuild counters from the vote rows after external drift", async () => {
		const { post } = await seedVotablePost();

		const voters = await Promise.all(
			Array.from({ length: 4 }, () => createUser()),
		);
		const tokens = await Promise.all(
			voters.map((voter) => generateAccessToken(voter.id)),
		);
		await Promise.all(
			tokens.map((token, index) =>
				castVote(post.id, token, index === 3 ? "DOWNVOTE" : "UPVOTE"),
			),
		);

		// Simulate the drift a restore or manual edit can cause: the counters are
		// corrupted while the votes table is left correct.
		await db.post.update({
			where: { id: post.id },
			data: { upvoteCount: 999, downvoteCount: 999, score: 999 },
		});

		const repaired = await voteRepository.resyncCounters(post.id);

		expect(repaired).toEqual({ upvoteCount: 3, downvoteCount: 1, score: 2 });
	});
});
