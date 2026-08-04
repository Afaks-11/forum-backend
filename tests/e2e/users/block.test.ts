import { beforeAll, describe, expect, it } from "@jest/globals";
import type { Application } from "express";
import supertest from "supertest";
import { createVerifiedUser } from "../auth.helper.js";
import { getE2EDatabase } from "../test-db.js";
import { getE2EServer } from "../test-server.js";

describe("POST /api/v1/users/:username/block", () => {
	let app: Application;
	let db: ReturnType<typeof getE2EDatabase>;

	beforeAll(async () => {
		app = await getE2EServer();
		db = await getE2EDatabase();
	});

	it("should allow an authenticated user to block another user", async () => {
		const blocker = await createVerifiedUser(app);
		const target = await createVerifiedUser(app);

		const res = await supertest(app)
			.post(`/api/v1/users/${target.username}/block`)
			.set("Authorization", `Bearer ${blocker.accessToken}`);

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
	});

	it("should remove existing follow relationship when blocking", async () => {
		const userA = await createVerifiedUser(app);
		const userB = await createVerifiedUser(app);

		await supertest(app)
			.post(`/api/v1/users/${userB.username}/follow`)
			.set("Authorization", `Bearer ${userA.accessToken}`);

		await supertest(app)
			.post(`/api/v1/users/${userB.username}/block`)
			.set("Authorization", `Bearer ${userA.accessToken}`);

		const follow = await db.follow.findUnique({
			where: {
				followerId_followingId: {
					followerId: userA.id,
					followingId: userB.id,
				},
			},
		});
		expect(follow).toBeNull();
	});

	it("should hide the blocker profile from the blocked user", async () => {
		const blocker = await createVerifiedUser(app);
		const blocked = await createVerifiedUser(app);

		await supertest(app)
			.post(`/api/v1/users/${blocked.username}/block`)
			.set("Authorization", `Bearer ${blocker.accessToken}`);

		const res = await supertest(app)
			.get(`/api/v1/users/${blocker.username}`)
			.set("Authorization", `Bearer ${blocked.accessToken}`);

		expect(res.status).toBe(404);
		expect(res.body.success).toBe(false);
	});

	it("should reject blocking yourself", async () => {
		const { accessToken, username } = await createVerifiedUser(app);

		const res = await supertest(app)
			.post(`/api/v1/users/${username}/block`)
			.set("Authorization", `Bearer ${accessToken}`);

		expect(res.status).toBe(400);
		expect(res.body.success).toBe(false);
	});

	it("should reject unauthenticated requests", async () => {
		const res = await supertest(app).post("/api/v1/users/test/block");

		expect(res.status).toBe(401);
		expect(res.body.success).toBe(false);
	});
});

describe("DELETE /api/v1/users/:username/unblock", () => {
	let app: Application;

	beforeAll(async () => {
		app = await getE2EServer();
	});

	it("should allow an authenticated user to unblock another user", async () => {
		const blocker = await createVerifiedUser(app);
		const target = await createVerifiedUser(app);

		await supertest(app)
			.post(`/api/v1/users/${target.username}/block`)
			.set("Authorization", `Bearer ${blocker.accessToken}`);

		const res = await supertest(app)
			.delete(`/api/v1/users/${target.username}/unblock`)
			.set("Authorization", `Bearer ${blocker.accessToken}`);

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);

		const profileRes = await supertest(app)
			.get(`/api/v1/users/${target.username}`)
			.set("Authorization", `Bearer ${blocker.accessToken}`);

		expect(profileRes.status).toBe(200);
	});

	it("should reject unauthenticated requests", async () => {
		const res = await supertest(app).delete("/api/v1/users/test/unblock");

		expect(res.status).toBe(401);
		expect(res.body.success).toBe(false);
	});
});
