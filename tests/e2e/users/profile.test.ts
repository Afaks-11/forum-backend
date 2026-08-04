import { beforeAll, describe, expect, it } from "@jest/globals";
import type { Application } from "express";
import supertest from "supertest";
import { createVerifiedUser } from "../auth.helper.js";
import { getE2EServer } from "../test-server.js";

describe("GET /api/v1/users/:username", () => {
	let app: Application;

	beforeAll(async () => {
		app = await getE2EServer();
	});

	it("should return a public profile for an existing user", async () => {
		const { username } = await createVerifiedUser(app);

		const res = await supertest(app).get(`/api/v1/users/${username}`);

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.data).toHaveProperty("username", username);
		expect(res.body.data).toHaveProperty("_count");
	});

	it("should include isFollowing when requested with authentication", async () => {
		const target = await createVerifiedUser(app);
		const viewer = await createVerifiedUser(app);

		const res = await supertest(app)
			.get(`/api/v1/users/${target.username}`)
			.set("Authorization", `Bearer ${viewer.accessToken}`);

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.data).toHaveProperty("isFollowing", false);
	});

	it("should return 404 for a non-existent user", async () => {
		const res = await supertest(app).get("/api/v1/users/nonexistentuser12345");

		expect(res.status).toBe(404);
		expect(res.body.success).toBe(false);
	});
});

describe("GET /api/v1/users/:username/posts", () => {
	let app: Application;

	beforeAll(async () => {
		app = await getE2EServer();
	});

	it("should return posts for a user with posts", async () => {
		const { accessToken, username } = await createVerifiedUser(app);

		const communityRes = await supertest(app)
			.post("/api/v1/communities")
			.set("Authorization", `Bearer ${accessToken}`)
			.send({
				name: "UserPostsComm",
				description: "Community for user post tests",
			});
		expect(communityRes.status).toBe(201);

		await supertest(app)
			.post("/api/v1/posts")
			.set("Authorization", `Bearer ${accessToken}`)
			.send({
				title: "User Post",
				content: "Content by user",
				type: "TEXT",
				communityId: communityRes.body.data.id,
			});

		const res = await supertest(app).get(`/api/v1/users/${username}/posts`);

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(Array.isArray(res.body.data)).toBe(true);
		expect(res.body.data.length).toBeGreaterThan(0);
	});

	it("should return empty array for a user with no posts", async () => {
		const { username } = await createVerifiedUser(app);

		const res = await supertest(app).get(`/api/v1/users/${username}/posts`);

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(Array.isArray(res.body.data)).toBe(true);
		expect(res.body.data.length).toBe(0);
	});
});

describe("GET /api/v1/users/:username/comments", () => {
	let app: Application;

	beforeAll(async () => {
		app = await getE2EServer();
	});

	it("should return comments for a user with comments", async () => {
		const { accessToken, username } = await createVerifiedUser(app);

		const communityRes = await supertest(app)
			.post("/api/v1/communities")
			.set("Authorization", `Bearer ${accessToken}`)
			.send({
				name: "UserCommentsComm",
				description: "Community for user comment tests",
			});
		expect(communityRes.status).toBe(201);

		const postRes = await supertest(app)
			.post("/api/v1/posts")
			.set("Authorization", `Bearer ${accessToken}`)
			.send({
				title: "Post for Comments",
				content: "Content",
				type: "TEXT",
				communityId: communityRes.body.data.id,
			});
		expect(postRes.status).toBe(201);

		await supertest(app)
			.post("/api/v1/comments")
			.set("Authorization", `Bearer ${accessToken}`)
			.send({
				content: "A test comment",
				postId: postRes.body.data.id,
			});

		const res = await supertest(app).get(`/api/v1/users/${username}/comments`);

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(Array.isArray(res.body.data)).toBe(true);
		expect(res.body.data.length).toBeGreaterThan(0);
	});

	it("should return empty array for a user with no comments", async () => {
		const { username } = await createVerifiedUser(app);

		const res = await supertest(app).get(`/api/v1/users/${username}/comments`);

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(Array.isArray(res.body.data)).toBe(true);
		expect(res.body.data.length).toBe(0);
	});
});

describe("GET /api/v1/users/search", () => {
	let app: Application;

	beforeAll(async () => {
		app = await getE2EServer();
	});

	it("should return users matching the query", async () => {
		const { username } = await createVerifiedUser(app);

		const res = await supertest(app)
			.get("/api/v1/users/search")
			.query({ query: username.slice(0, 5), limit: "10" });

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(Array.isArray(res.body.data)).toBe(true);
	});

	it("should reject empty search query", async () => {
		const res = await supertest(app)
			.get("/api/v1/users/search")
			.query({ query: "" });

		expect(res.status).toBe(400);
		expect(res.body.success).toBe(false);
	});
});
