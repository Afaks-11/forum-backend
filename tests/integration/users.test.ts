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

const createUser = (overrides = {}) =>
	db.user.create({
		data: {
			id: crypto.randomUUID(),
			username: `u_${crypto.randomBytes(4).toString("hex")}`,
			email: `e_${crypto.randomBytes(4).toString("hex")}@t.com`,
			password: "$2b$10$abcdefghijklmnopqrstuvwxyzA1234567890FakeHash",
			isEmailVerified: true,
			role: "USER",
			...overrides,
		},
	});

describe("GET /api/v1/users/:username", () => {
	it("should return public profile without auth", async () => {
		await createUser({ username: "publicuser" });

		const res = await request.get("/api/v1/users/publicuser");

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.data.username).toBe("publicuser");
	});

	it("should return profile with isFollowing when authenticated", async () => {
		const viewer = await createUser();
		const target = await createUser({ username: "targetuser" });
		await db.follow.create({
			data: { followerId: viewer.id, followingId: target.id },
		});
		const token = await generateAccessToken(viewer.id);

		const res = await request
			.get("/api/v1/users/targetuser")
			.set("Authorization", `Bearer ${token}`);

		expect(res.status).toBe(200);
		expect(res.body.data.isFollowing).toBe(true);
	});

	it("should return 404 when blocked", async () => {
		const viewer = await createUser();
		const target = await createUser({ username: "blockeduser" });
		await db.block.create({
			data: { blockerId: target.id, blockedId: viewer.id },
		});
		const token = await generateAccessToken(viewer.id);

		const res = await request
			.get("/api/v1/users/blockeduser")
			.set("Authorization", `Bearer ${token}`);

		expect(res.status).toBe(404);
	});

	it("should return 404 for non-existent user", async () => {
		const res = await request.get("/api/v1/users/nonexistentuser12345");
		expect(res.status).toBe(404);
	});
});

describe("PATCH /api/v1/auth/me", () => {
	it("should update profile when authenticated", async () => {
		const user = await createUser({ username: "oldname" });
		const token = await generateAccessToken(user.id);

		const res = await request
			.patch("/api/v1/auth/me")
			.set("Authorization", `Bearer ${token}`)
			.send({ username: "newname" });

		// PATCH mutates an existing resource, so 200 is correct; 201 would assert
		// that a new resource had been created.
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.data.updatedUserProfileDetails.username).toBe("newname");
	});

	it("should return 401 without auth", async () => {
		const res = await request
			.patch("/api/v1/auth/me")
			.send({ username: "new" });
		expect(res.status).toBe(401);
	});

	it("should return 409 for duplicate username", async () => {
		await createUser({ username: "taken" });
		const userB = await createUser({ username: "original" });
		const token = await generateAccessToken(userB.id);

		const res = await request
			.patch("/api/v1/auth/me")
			.set("Authorization", `Bearer ${token}`)
			.send({ username: "taken" });

		expect(res.status).toBe(409);
	});

	it("should return 400 for invalid username", async () => {
		const user = await createUser();
		const token = await generateAccessToken(user.id);

		const res = await request
			.patch("/api/v1/auth/me")
			.set("Authorization", `Bearer ${token}`)
			.send({ username: "ab" });

		expect(res.status).toBe(400);
	});
});

describe("DELETE /api/v1/auth/me", () => {
	it("should soft-delete the account when authenticated", async () => {
		const user = await createUser();
		const token = await generateAccessToken(user.id);

		const res = await request
			.delete("/api/v1/auth/me")
			.set("Authorization", `Bearer ${token}`);

		expect(res.status).toBe(204);

		// Account deletion is a soft delete: the row is retained so that authored
		// posts and comments keep a valid foreign key, and `deletedAt` is what
		// gates login and profile access.
		const deleted = await db.user.findUnique({ where: { id: user.id } });
		expect(deleted).not.toBeNull();
		expect(deleted?.deletedAt).not.toBeNull();
	});

	it("should return 401 without auth", async () => {
		const res = await request.delete("/api/v1/auth/me");
		expect(res.status).toBe(401);
	});
});
