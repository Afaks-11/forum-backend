import crypto from "node:crypto";
import { beforeAll, describe, expect, it } from "@jest/globals";
import supertest from "supertest";
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
			description: "Test community",
			creatorId,
		},
	});

const createPost = (authorId: string, communityId: string, overrides = {}) =>
	db.post.create({
		data: {
			title: "Test Post",
			content: "Test content",
			authorId,
			communityId,
			...overrides,
		},
	});

const createComment = (authorId: string, postId: string, overrides = {}) =>
	db.comment.create({
		data: {
			content: "Test comment",
			authorId,
			postId,
			...overrides,
		},
	});

describe("POST /api/v1/comments", () => {
	it("should create a comment on a post", async () => {
		const user = await createUser();
		const community = await createCommunity(user.id);
		const post = await createPost(user.id, community.id);
		const token = await generateAccessToken(user.id);

		const res = await request
			.post("/api/v1/comments")
			.set("Authorization", `Bearer ${token}`)
			.send({ content: "Nice post!", postId: post.id });

		expect(res.status).toBe(201);
		expect(res.body.success).toBe(true);
		expect(res.body.data.content).toBe("Nice post!");
	});

	it("should create a reply to a comment", async () => {
		const user = await createUser();
		const community = await createCommunity(user.id);
		const post = await createPost(user.id, community.id);
		const parent = await createComment(user.id, post.id);
		const token = await generateAccessToken(user.id);

		const res = await request
			.post("/api/v1/comments")
			.set("Authorization", `Bearer ${token}`)
			.send({ content: "Reply!", postId: post.id, parentId: parent.id });

		expect(res.status).toBe(201);
		expect(res.body.data.parentId).toBe(parent.id);
	});

	it("should return 401 without auth", async () => {
		const res = await request
			.post("/api/v1/comments")
			.send({ content: "Nice", postId: crypto.randomUUID() });
		expect(res.status).toBe(401);
	});

	it("should return 404 for non-existent post", async () => {
		const user = await createUser();
		const token = await generateAccessToken(user.id);

		const res = await request
			.post("/api/v1/comments")
			.set("Authorization", `Bearer ${token}`)
			.send({ content: "Nice", postId: crypto.randomUUID() });

		expect(res.status).toBe(404);
	});

	it("should return 400 for locked post", async () => {
		const user = await createUser();
		const community = await createCommunity(user.id);
		const post = await createPost(user.id, community.id, { isLocked: true });
		const token = await generateAccessToken(user.id);

		const res = await request
			.post("/api/v1/comments")
			.set("Authorization", `Bearer ${token}`)
			.send({ content: "Nice", postId: post.id });

		expect(res.status).toBe(400);
	});

	it("should return 400 for empty content", async () => {
		const user = await createUser();
		const community = await createCommunity(user.id);
		const post = await createPost(user.id, community.id);
		const token = await generateAccessToken(user.id);

		const res = await request
			.post("/api/v1/comments")
			.set("Authorization", `Bearer ${token}`)
			.send({ content: "", postId: post.id });

		expect(res.status).toBe(400);
	});
});

describe("GET /api/v1/comments/post/:postId", () => {
	it("should return comments for a post", async () => {
		const user = await createUser();
		const community = await createCommunity(user.id);
		const post = await createPost(user.id, community.id);
		await createComment(user.id, post.id);
		const token = await generateAccessToken(user.id);

		const res = await request
			.get(`/api/v1/comments/post/${post.id}`)
			.set("Authorization", `Bearer ${token}`);

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(Array.isArray(res.body.data)).toBe(true);
	});

	it("should return 401 without auth", async () => {
		const res = await request.get(
			`/api/v1/comments/post/${crypto.randomUUID()}`,
		);
		expect(res.status).toBe(401);
	});
});

describe("PATCH /api/v1/comments/:id", () => {
	it("should update comment when author is authenticated", async () => {
		const user = await createUser();
		const community = await createCommunity(user.id);
		const post = await createPost(user.id, community.id);
		const comment = await createComment(user.id, post.id);
		const token = await generateAccessToken(user.id);

		const res = await request
			.patch(`/api/v1/comments/${comment.id}`)
			.set("Authorization", `Bearer ${token}`)
			.send({ content: "Updated content" });

		expect(res.status).toBe(200);
		expect(res.body.data.content).toBe("Updated content");
		expect(res.body.data.isEdited).toBe(true);
	});

	it("should return 403 when non-author tries to edit", async () => {
		const author = await createUser();
		const hacker = await createUser();
		const community = await createCommunity(author.id);
		const post = await createPost(author.id, community.id);
		const comment = await createComment(author.id, post.id);
		const token = await generateAccessToken(hacker.id);

		const res = await request
			.patch(`/api/v1/comments/${comment.id}`)
			.set("Authorization", `Bearer ${token}`)
			.send({ content: "Hacked" });

		expect(res.status).toBe(403);
	});

	it("should return 404 for missing comment", async () => {
		const user = await createUser();
		const token = await generateAccessToken(user.id);

		const res = await request
			.patch(`/api/v1/comments/${crypto.randomUUID()}`)
			.set("Authorization", `Bearer ${token}`)
			.send({ content: "Ghost" });

		expect(res.status).toBe(404);
	});

	it("should return 404 for deleted comment", async () => {
		const user = await createUser();
		const community = await createCommunity(user.id);
		const post = await createPost(user.id, community.id);
		const comment = await createComment(user.id, post.id, {
			deletedAt: new Date(),
		});
		const token = await generateAccessToken(user.id);

		const res = await request
			.patch(`/api/v1/comments/${comment.id}`)
			.set("Authorization", `Bearer ${token}`)
			.send({ content: "Nope" });

		expect(res.status).toBe(404);
	});
});

describe("DELETE /api/v1/comments/:id", () => {
	it("should soft-delete comment when author is authenticated", async () => {
		const user = await createUser();
		const community = await createCommunity(user.id);
		const post = await createPost(user.id, community.id);
		const comment = await createComment(user.id, post.id);
		const token = await generateAccessToken(user.id);

		const res = await request
			.delete(`/api/v1/comments/${comment.id}`)
			.set("Authorization", `Bearer ${token}`);

		expect(res.status).toBe(204);
		const deleted = await db.comment.findUnique({ where: { id: comment.id } });
		expect(deleted?.deletedAt).not.toBeNull();
	});

	it("should return 403 when non-author tries to delete", async () => {
		const author = await createUser();
		const hacker = await createUser();
		const community = await createCommunity(author.id);
		const post = await createPost(author.id, community.id);
		const comment = await createComment(author.id, post.id);
		const token = await generateAccessToken(hacker.id);

		const res = await request
			.delete(`/api/v1/comments/${comment.id}`)
			.set("Authorization", `Bearer ${token}`);

		// Authenticated caller, wrong owner: authorization failure, not authentication.
		expect(res.status).toBe(403);
	});

	it("should return 404 for missing comment", async () => {
		const user = await createUser();
		const token = await generateAccessToken(user.id);

		const res = await request
			.delete(`/api/v1/comments/${crypto.randomUUID()}`)
			.set("Authorization", `Bearer ${token}`);

		expect(res.status).toBe(404);
	});
});
