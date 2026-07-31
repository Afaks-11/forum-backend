import crypto from "node:crypto";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "@jest/globals";
import supertest from "supertest";
import { getTestApp } from "../helpers/app.js";
import { generateAccessToken } from "../helpers/auth.js";
import {
	closeTestDatabase,
	getTestDatabase,
	truncateTables,
} from "../helpers/database.js";

let request: supertest.Agent;
let db: ReturnType<typeof getTestDatabase>;

beforeAll(async () => {
	const app = await getTestApp();
	request = supertest(app);
	db = getTestDatabase();
});

beforeEach(async () => {
	await truncateTables(db);
});

afterAll(async () => {
	await closeTestDatabase().catch(() => {});
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

const createPost = (authorId: string, communityId: string) =>
	db.post.create({
		data: {
			title: "Test Post",
			content: "Test content",
			authorId,
			communityId,
		},
	});

describe("POST /api/v1/votes", () => {
	it("should create an upvote", async () => {
		const user = await createUser();
		const community = await createCommunity(user.id);
		const post = await createPost(user.id, community.id);
		const token = await generateAccessToken(user.id);

		const res = await request
			.post("/api/v1/votes")
			.set("Authorization", `Bearer ${token}`)
			.send({ postId: post.id, type: "UPVOTE" });

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.data).toBe("CREATED");
	});

	it("should remove vote when same type is sent again", async () => {
		const user = await createUser();
		const community = await createCommunity(user.id);
		const post = await createPost(user.id, community.id);
		const token = await generateAccessToken(user.id);

		await request
			.post("/api/v1/votes")
			.set("Authorization", `Bearer ${token}`)
			.send({ postId: post.id, type: "UPVOTE" });

		const res = await request
			.post("/api/v1/votes")
			.set("Authorization", `Bearer ${token}`)
			.send({ postId: post.id, type: "UPVOTE" });

		expect(res.status).toBe(200);
		expect(res.body.data).toBe("REMOVED");
	});

	it("should change vote type", async () => {
		const user = await createUser();
		const community = await createCommunity(user.id);
		const post = await createPost(user.id, community.id);
		const token = await generateAccessToken(user.id);

		await request
			.post("/api/v1/votes")
			.set("Authorization", `Bearer ${token}`)
			.send({ postId: post.id, type: "UPVOTE" });

		const res = await request
			.post("/api/v1/votes")
			.set("Authorization", `Bearer ${token}`)
			.send({ postId: post.id, type: "DOWNVOTE" });

		expect(res.status).toBe(200);
		expect(res.body.data).toBe("CHANGED");
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
		expect(res.body.message).toBe("Invalid Input Data");
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
