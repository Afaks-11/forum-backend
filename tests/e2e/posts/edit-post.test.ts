import { beforeAll, describe, expect, it } from "@jest/globals";
import type { Application } from "express";
import supertest from "supertest";
import { createVerifiedUser } from "../auth.helper.js";
import { getE2EServer } from "../test-server.js";

describe("PATCH /api/v1/posts/:id", () => {
	let app: Application;

	beforeAll(async () => {
		app = await getE2EServer();
	});

	it("should allow the author to edit their post", async () => {
		const { accessToken } = await createVerifiedUser(app);

		const communityRes = await supertest(app)
			.post("/api/v1/communities")
			.set("Authorization", `Bearer ${accessToken}`)
			.send({
				name: "EditPostComm",
				description: "Community for editing posts",
			});
		expect(communityRes.status).toBe(201);

		const postRes = await supertest(app)
			.post("/api/v1/posts")
			.set("Authorization", `Bearer ${accessToken}`)
			.send({
				title: "Original Title",
				content: "Original content.",
				type: "TEXT",
				communityId: communityRes.body.data.id,
			});
		expect(postRes.status).toBe(201);
		const postId = postRes.body.data.id;

		const res = await supertest(app)
			.patch(`/api/v1/posts/${postId}`)
			.set("Authorization", `Bearer ${accessToken}`)
			.send({ title: "Updated Title", content: "Updated content." });

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.data.title).toBe("Updated Title");
	});

	it("should reject non-author edits", async () => {
		const author = await createVerifiedUser(app);
		const hacker = await createVerifiedUser(app);

		const communityRes = await supertest(app)
			.post("/api/v1/communities")
			.set("Authorization", `Bearer ${author.accessToken}`)
			.send({ name: "HackerComm", description: "Testing unauthorized edits" });
		expect(communityRes.status).toBe(201);

		const postRes = await supertest(app)
			.post("/api/v1/posts")
			.set("Authorization", `Bearer ${author.accessToken}`)
			.send({
				title: "Protected Post",
				content: "Sensitive content.",
				type: "TEXT",
				communityId: communityRes.body.data.id,
			});
		expect(postRes.status).toBe(201);

		const res = await supertest(app)
			.patch(`/api/v1/posts/${postRes.body.data.id}`)
			.set("Authorization", `Bearer ${hacker.accessToken}`)
			.send({ title: "Hacked Title" });

		expect(res.status).toBe(403);
		expect(res.body.success).toBe(false);
	});

	it("should reject unauthenticated requests", async () => {
		const res = await supertest(app)
			.patch("/api/v1/posts/00000000-0000-0000-0000-000000000000")
			.send({ title: "Anonymous Edit" });

		expect(res.status).toBe(401);
		expect(res.body.success).toBe(false);
	});

	it("should return 404 for missing post", async () => {
		const { accessToken } = await createVerifiedUser(app);

		const res = await supertest(app)
			.patch("/api/v1/posts/00000000-0000-0000-0000-000000000000")
			.set("Authorization", `Bearer ${accessToken}`)
			.send({ title: "Ghost Edit" });

		expect(res.status).toBe(404);
		expect(res.body.success).toBe(false);
	});
});
