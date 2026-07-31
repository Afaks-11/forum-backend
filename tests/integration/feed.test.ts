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

const createCommunity = (creatorId: string, name: string, slug: string) =>
	db.community.create({
		data: {
			id: crypto.randomUUID(),
			name,
			slug,
			creatorId,
		},
	});

const createPost = (authorId: string, communityId: string, title: string) =>
	db.post.create({
		data: {
			title,
			content: "Content",
			authorId,
			communityId,
		},
	});

describe("GET /api/v1/posts (Home Feed)", () => {
	it("should return feed with default sort", async () => {
		const user = await createUser();
		const community = await createCommunity(user.id, "FeedTest", "feedtest");
		await createPost(user.id, community.id, "Post A");
		await createPost(user.id, community.id, "Post B");

		const res = await request.get("/api/v1/posts");

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(Array.isArray(res.body.data)).toBe(true);
		expect(res.body.data.length).toBeGreaterThanOrEqual(2);
	});

	it("should paginate with cursor", async () => {
		const user = await createUser();
		const community = await createCommunity(user.id, "PageTest", "pagetest");
		const _post1 = await createPost(user.id, community.id, "First");
		await createPost(user.id, community.id, "Second");

		const res1 = await request.get("/api/v1/posts?limit=1");
		expect(res1.status).toBe(200);
		expect(res1.body.data.length).toBe(1);
		expect(res1.body.nextCursor).toBeTruthy();

		const res2 = await request.get(
			`/api/v1/posts?limit=1&cursor=${res1.body.nextCursor}`,
		);
		expect(res2.status).toBe(200);
		expect(res2.body.data.length).toBe(1);
	});

	it("should sort by top", async () => {
		const user = await createUser();
		const community = await createCommunity(user.id, "TopTest", "toptest");
		await createPost(user.id, community.id, "Top Post");

		const res = await request.get("/api/v1/posts?sort=top");

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
	});

	it("should filter by community", async () => {
		const user = await createUser();
		const commA = await createCommunity(user.id, "CommA", "comma");
		const commB = await createCommunity(user.id, "CommB", "commb");
		await createPost(user.id, commA.id, "In A");
		await createPost(user.id, commB.id, "In B");

		const res = await request.get("/api/v1/posts?community=comma");

		expect(res.status).toBe(200);
		expect(res.body.data.length).toBe(1);
		expect(res.body.data[0].title).toBe("In A");
	});

	it("should return empty feed when no posts exist", async () => {
		const res = await request.get("/api/v1/posts");
		expect(res.status).toBe(200);
		expect(res.body.data).toEqual([]);
		expect(res.body.nextCursor).toBeNull();
	});
});
