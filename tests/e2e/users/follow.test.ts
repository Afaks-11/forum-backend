import { beforeAll, describe, expect, it } from "@jest/globals";
import type { Application } from "express";
import supertest from "supertest";
import { createVerifiedUser } from "../auth.helper.js";
import { getE2EServer } from "../test-server.js";

describe("POST /api/v1/users/:username/follow", () => {
	let app: Application;

	beforeAll(async () => {
		app = await getE2EServer();
	});

	it("should allow an authenticated user to follow another user", async () => {
		const follower = await createVerifiedUser(app);
		const target = await createVerifiedUser(app);

		const res = await supertest(app)
			.post(`/api/v1/users/${target.username}/follow`)
			.set("Authorization", `Bearer ${follower.accessToken}`);

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);

		const profileRes = await supertest(app)
			.get(`/api/v1/users/${target.username}`)
			.set("Authorization", `Bearer ${follower.accessToken}`);

		expect(profileRes.status).toBe(200);
		expect(profileRes.body.data.isFollowing).toBe(true);
	});

	it("should reject following yourself", async () => {
		const { accessToken, username } = await createVerifiedUser(app);

		const res = await supertest(app)
			.post(`/api/v1/users/${username}/follow`)
			.set("Authorization", `Bearer ${accessToken}`);

		expect(res.status).toBe(400);
		expect(res.body.success).toBe(false);
	});

	it("should reject unauthenticated requests", async () => {
		const res = await supertest(app).post("/api/v1/users/test/follow");

		expect(res.status).toBe(401);
		expect(res.body.success).toBe(false);
	});
});

describe("DELETE /api/v1/users/:username/unfollow", () => {
	let app: Application;

	beforeAll(async () => {
		app = await getE2EServer();
	});

	it("should allow an authenticated user to unfollow another user", async () => {
		const follower = await createVerifiedUser(app);
		const target = await createVerifiedUser(app);

		await supertest(app)
			.post(`/api/v1/users/${target.username}/follow`)
			.set("Authorization", `Bearer ${follower.accessToken}`);

		const res = await supertest(app)
			.delete(`/api/v1/users/${target.username}/unfollow`)
			.set("Authorization", `Bearer ${follower.accessToken}`);

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);

		const profileRes = await supertest(app)
			.get(`/api/v1/users/${target.username}`)
			.set("Authorization", `Bearer ${follower.accessToken}`);

		expect(profileRes.status).toBe(200);
		expect(profileRes.body.data.isFollowing).toBe(false);
	});

	it("should reject unauthenticated requests", async () => {
		const res = await supertest(app).delete("/api/v1/users/test/unfollow");

		expect(res.status).toBe(401);
		expect(res.body.success).toBe(false);
	});
});
