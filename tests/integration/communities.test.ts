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

describe("POST /api/v1/communities", () => {
	it("should create a community when authenticated", async () => {
		const user = await createUser();
		const token = await generateAccessToken(user.id);

		const res = await request
			.post("/api/v1/communities")
			.set("Authorization", `Bearer ${token}`)
			.send({ name: "TestCommunity", description: "A test community" });

		expect(res.status).toBe(201);
		expect(res.body.success).toBe(true);
		expect(res.body.data.slug).toBe("testcommunity");
	});

	it("should return 401 without auth", async () => {
		const res = await request
			.post("/api/v1/communities")
			.send({ name: "Test" });
		expect(res.status).toBe(401);
	});

	it("should return 409 for duplicate name", async () => {
		const user = await createUser();
		const token = await generateAccessToken(user.id);

		await request
			.post("/api/v1/communities")
			.set("Authorization", `Bearer ${token}`)
			.send({ name: "Duplicate", description: "First community" });

		const res = await request
			.post("/api/v1/communities")
			.set("Authorization", `Bearer ${token}`)
			.send({ name: "Duplicate", description: "Second community" });

		expect(res.status).toBe(409);
	});

	it("should return 400 for validation failure", async () => {
		const user = await createUser();
		const token = await generateAccessToken(user.id);

		const res = await request
			.post("/api/v1/communities")
			.set("Authorization", `Bearer ${token}`)
			.send({ name: "ab", description: "short" });

		expect(res.status).toBe(400);
	});
});

describe("POST /api/v1/communities/:slug/join", () => {
	it("should allow authenticated user to join", async () => {
		const creator = await createUser();
		const joiner = await createUser();
		const community = await db.community.create({
			data: {
				id: crypto.randomUUID(),
				name: `C_${crypto.randomBytes(4).toString("hex")}`,
				slug: `c-${crypto.randomBytes(4).toString("hex")}`,
				creatorId: creator.id,
			},
		});
		const token = await generateAccessToken(joiner.id);

		const res = await request
			.post(`/api/v1/communities/${community.slug}/join`)
			.set("Authorization", `Bearer ${token}`);

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
	});

	it("should return 401 without auth", async () => {
		const res = await request.post("/api/v1/communities/test/join");
		expect(res.status).toBe(401);
	});

	it("should return 404 for non-existent community", async () => {
		const user = await createUser();
		const token = await generateAccessToken(user.id);

		const res = await request
			.post("/api/v1/communities/nonexistent/join")
			.set("Authorization", `Bearer ${token}`);

		expect(res.status).toBe(404);
	});
});

describe("DELETE /api/v1/communities/:slug/leave", () => {
	it("should allow member to leave", async () => {
		const creator = await createUser();
		const member = await createUser();
		const community = await db.community.create({
			data: {
				id: crypto.randomUUID(),
				name: `C_${crypto.randomBytes(4).toString("hex")}`,
				slug: `c-${crypto.randomBytes(4).toString("hex")}`,
				creatorId: creator.id,
			},
		});
		await db.membership.create({
			data: { userId: member.id, communityId: community.id, role: "MEMBER" },
		});
		const token = await generateAccessToken(member.id);

		const res = await request
			.delete(`/api/v1/communities/${community.slug}/leave`)
			.set("Authorization", `Bearer ${token}`);

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
	});

	it("should return 404 for non-existent community", async () => {
		const user = await createUser();
		const token = await generateAccessToken(user.id);

		const res = await request
			.delete("/api/v1/communities/nonexistent/leave")
			.set("Authorization", `Bearer ${token}`);

		expect(res.status).toBe(404);
	});
});
