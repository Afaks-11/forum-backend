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
			slug: `c-${crypto.randomBytes(4).toString("hex")}`,
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

describe("POST /api/v1/posts", () => {
	it("should create a post with valid data", async () => {
		const user = await createUser();
		const community = await createCommunity(user.id);
		const token = await generateAccessToken(user.id);

		const res = await request
			.post("/api/v1/posts")
			.set("Authorization", `Bearer ${token}`)
			.send({
				title: "Valid Title",
				content: "Valid content",
				communityId: community.id,
				type: "TEXT",
			});

		expect(res.status).toBe(201);
		expect(res.body.success).toBe(true);
		expect(res.body.data.title).toBe("Valid Title");
		console.log("ERROR BODY:", res.status, res.body);
	});

	it("should return 400 for validation failure", async () => {
		const user = await createUser();
		const token = await generateAccessToken(user.id);

		const res = await request
			.post("/api/v1/posts")
			.set("Authorization", `Bearer ${token}`)
			.send({
				title: "ab",
				content: "",
				communityId: "not-a-uuid",
			});

		expect(res.status).toBe(400);
		expect(res.body.success).toBe(false);
	});

	it("should return 401 when not authenticated", async () => {
		const res = await request.post("/api/v1/posts").send({
			title: "Title",
			content: "Content",
			communityId: crypto.randomUUID(),
		});
		expect(res.status).toBe(401);
		expect(res.body.success).toBe(false);
	});

	it("should return 404 for non-existent community", async () => {
		const user = await createUser();
		const token = await generateAccessToken(user.id);

		const res = await request
			.post("/api/v1/posts")
			.set("Authorization", `Bearer ${token}`)
			.send({
				title: "Title",
				content: "Content",
				communityId: crypto.randomUUID(),
				type: "TEXT",
			});

		expect(res.status).toBe(404);
		expect(res.body.success).toBe(false);
	});

	it("should return 400 for business rule failure (title too short)", async () => {
		const user = await createUser();
		const community = await createCommunity(user.id);
		const token = await generateAccessToken(user.id);

		const res = await request
			.post("/api/v1/posts")
			.set("Authorization", `Bearer ${token}`)
			.send({
				title: "ab",
				content: "Content",
				communityId: community.id,
				type: "TEXT",
			});

		expect(res.status).toBe(400);
		expect(res.body.success).toBe(false);
	});
});

describe("GET /api/v1/posts", () => {
	it("should return active posts feed", async () => {
		const user = await createUser();
		const community = await createCommunity(user.id);
		await createPost(user.id, community.id);
		await createPost(user.id, community.id, { title: "Second" });

		const res = await request.get("/api/v1/posts");

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(Array.isArray(res.body.data)).toBe(true);
		expect(res.body.data.length).toBeGreaterThanOrEqual(2);
	});

	it("should paginate with limit query", async () => {
		const user = await createUser();
		const community = await createCommunity(user.id);
		await createPost(user.id, community.id);
		await createPost(user.id, community.id);

		const res = await request.get("/api/v1/posts?limit=1");

		expect(res.status).toBe(200);
		expect(res.body.data.length).toBe(1);
		expect(res.body.nextCursor).toBeDefined();
	});

	it("should filter by community slug", async () => {
		const user = await createUser();
		const community = await createCommunity(user.id);
		await createPost(user.id, community.id);

		const res = await request.get(`/api/v1/posts?community=${community.slug}`);

		expect(res.status).toBe(200);
		expect(res.body.data.length).toBe(1);
	});

	it("should return empty array when no posts exist", async () => {
		const res = await request.get("/api/v1/posts");
		expect(res.status).toBe(200);
		expect(res.body.data).toEqual([]);
		expect(res.body.nextCursor).toBeNull();
	});
});

describe("GET /api/v1/posts/:id", () => {
	it("should return a single post", async () => {
		const user = await createUser();
		const community = await createCommunity(user.id);
		const post = await createPost(user.id, community.id);

		const res = await request.get(`/api/v1/posts/${post.id}`);

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.data.id).toBe(post.id);
	});

	it("should return 400 for invalid UUID", async () => {
		const res = await request.get("/api/v1/posts/invalid-uuid");
		expect(res.status).toBe(400);
		expect(res.body.success).toBe(false);
	});

	it("should return 404 for missing post", async () => {
		const res = await request.get(`/api/v1/posts/${crypto.randomUUID()}`);
		expect(res.status).toBe(404);
		expect(res.body.success).toBe(false);
	});

	it("should return 404 for deleted post", async () => {
		const user = await createUser();
		const community = await createCommunity(user.id);
		const post = await createPost(user.id, community.id, {
			deletedAt: new Date(),
		});

		const res = await request.get(`/api/v1/posts/${post.id}`);
		expect(res.status).toBe(404);
	});
});

describe("PATCH /api/v1/posts/:id", () => {
	it("should update post when author is authenticated", async () => {
		const user = await createUser();
		const community = await createCommunity(user.id);
		const post = await createPost(user.id, community.id);
		const token = await generateAccessToken(user.id);

		const res = await request
			.patch(`/api/v1/posts/${post.id}`)
			.set("Authorization", `Bearer ${token}`)
			.send({ title: "Updated Title" });

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.data.title).toBe("Updated Title");
	});

	it("should return 401 when not authenticated", async () => {
		const res = await request
			.patch(`/api/v1/posts/${crypto.randomUUID()}`)
			.send({ title: "Hack" });
		expect(res.status).toBe(401);
	});

	it("should return 403 when non-author tries to update", async () => {
		const author = await createUser();
		const hacker = await createUser();
		const community = await createCommunity(author.id);
		const post = await createPost(author.id, community.id);
		const token = await generateAccessToken(hacker.id);

		const res = await request
			.patch(`/api/v1/posts/${post.id}`)
			.set("Authorization", `Bearer ${token}`)
			.send({ title: "Hacked" });

		expect(res.status).toBe(403);
		expect(res.body.success).toBe(false);
	});

	it("should return 404 for missing post", async () => {
		const user = await createUser();
		const token = await generateAccessToken(user.id);

		const res = await request
			.patch(`/api/v1/posts/${crypto.randomUUID()}`)
			.set("Authorization", `Bearer ${token}`)
			.send({ title: "Ghost" });

		expect(res.status).toBe(404);
	});

	it("should return 400 for invalid param UUID", async () => {
		const user = await createUser();
		const token = await generateAccessToken(user.id);

		const res = await request
			.patch("/api/v1/posts/bad-id")
			.set("Authorization", `Bearer ${token}`)
			.send({ title: "Title" });

		expect(res.status).toBe(400);
	});
});

describe("DELETE /api/v1/posts/:id", () => {
	it("should soft-delete post when author is authenticated", async () => {
		const user = await createUser();
		const community = await createCommunity(user.id);
		const post = await createPost(user.id, community.id);
		const token = await generateAccessToken(user.id);

		const res = await request
			.delete(`/api/v1/posts/${post.id}`)
			.set("Authorization", `Bearer ${token}`);

		expect(res.status).toBe(204);
		const deleted = await db.post.findUnique({ where: { id: post.id } });
		expect(deleted?.deletedAt).not.toBeNull();
	});

	it("should return 401 when not authenticated", async () => {
		const res = await request.delete(`/api/v1/posts/${crypto.randomUUID()}`);
		expect(res.status).toBe(401);
	});

	it("should return 401 when non-author tries to delete", async () => {
		const author = await createUser();
		const hacker = await createUser();
		const community = await createCommunity(author.id);
		const post = await createPost(author.id, community.id);
		const token = await generateAccessToken(hacker.id);

		const res = await request
			.delete(`/api/v1/posts/${post.id}`)
			.set("Authorization", `Bearer ${token}`);

		expect(res.status).toBe(401);
	});

	it("should return 404 for missing post", async () => {
		const user = await createUser();
		const token = await generateAccessToken(user.id);

		const res = await request
			.delete(`/api/v1/posts/${crypto.randomUUID()}`)
			.set("Authorization", `Bearer ${token}`);

		expect(res.status).toBe(404);
	});
});

describe("POST /api/v1/posts/:id/save", () => {
	it("should save a post", async () => {
		const user = await createUser();
		const community = await createCommunity(user.id);
		const post = await createPost(user.id, community.id);
		const token = await generateAccessToken(user.id);

		const res = await request
			.post(`/api/v1/posts/${post.id}/save`)
			.set("Authorization", `Bearer ${token}`);

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
	});

	it("should return 401 without auth", async () => {
		const res = await request.post(`/api/v1/posts/${crypto.randomUUID()}/save`);
		expect(res.status).toBe(401);
	});
});

describe("POST /api/v1/posts/:id/pin", () => {
	it("should pin post when user is moderator", async () => {
		const mod = await createUser();
		await db.user.update({
			where: { id: mod.id },
			data: { role: "MODERATOR" },
		});
		const community = await createCommunity(mod.id);
		const post = await createPost(mod.id, community.id);
		const token = await generateAccessToken(mod.id);

		const res = await request
			.post(`/api/v1/posts/${post.id}/pin`)
			.set("Authorization", `Bearer ${token}`)
			.send({ isPinned: true });

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
	});

	it("should return 403 when user is not moderator", async () => {
		const user = await createUser();
		const community = await createCommunity(user.id);
		const post = await createPost(user.id, community.id);
		const token = await generateAccessToken(user.id);

		const res = await request
			.post(`/api/v1/posts/${post.id}/pin`)
			.set("Authorization", `Bearer ${token}`)
			.send({ isPinned: true });

		expect(res.status).toBe(403);
	});
});

describe("POST /api/v1/posts/:id/lock", () => {
	it("should lock post when user is author", async () => {
		const user = await createUser();
		const community = await createCommunity(user.id);
		const post = await createPost(user.id, community.id);
		const token = await generateAccessToken(user.id);

		const res = await request
			.post(`/api/v1/posts/${post.id}/lock`)
			.set("Authorization", `Bearer ${token}`)
			.send({ isLocked: true });

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
	});

	it("should lock post when user is moderator", async () => {
		const mod = await createUser();
		await db.user.update({
			where: { id: mod.id },
			data: { role: "MODERATOR" },
		});
		const author = await createUser();
		const community = await createCommunity(mod.id);
		const post = await createPost(author.id, community.id);
		const token = await generateAccessToken(mod.id);

		const res = await request
			.post(`/api/v1/posts/${post.id}/lock`)
			.set("Authorization", `Bearer ${token}`)
			.send({ isLocked: true });

		expect(res.status).toBe(200);
	});

	it("should return 401 when non-author non-mod tries to lock", async () => {
		const author = await createUser();
		const hacker = await createUser();
		const community = await createCommunity(author.id);
		const post = await createPost(author.id, community.id);
		const token = await generateAccessToken(hacker.id);

		const res = await request
			.post(`/api/v1/posts/${post.id}/lock`)
			.set("Authorization", `Bearer ${token}`)
			.send({ isLocked: true });

		expect(res.status).toBe(401);
	});
});

describe("GET /api/v1/posts/search", () => {
	it("should search posts by query", async () => {
		const user = await createUser();
		const community = await createCommunity(user.id);
		await createPost(user.id, community.id, {
			title: "UniqueSearchTerm",
		});

		const res = await request.get(
			"/api/v1/posts/search?query=UniqueSearchTerm",
		);

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.data.length).toBeGreaterThanOrEqual(1);
	});

	it("should return 400 for missing query", async () => {
		const res = await request.get("/api/v1/posts/search");
		expect(res.status).toBe(400);
	});
});
