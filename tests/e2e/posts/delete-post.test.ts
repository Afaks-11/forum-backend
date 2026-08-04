import { beforeAll, describe, expect, it } from "@jest/globals";
import type { Application } from "express";
import supertest from "supertest";
import { createVerifiedUser } from "../auth.helper.js";
import { getE2EDatabase } from "../test-db.js";
import { getE2EServer } from "../test-server.js";

describe("DELETE /api/v1/posts/:id", () => {
	let app: Application;
	let db: ReturnType<typeof getE2EDatabase>;

	beforeAll(async () => {
		app = await getE2EServer();
		db = getE2EDatabase();
	});

	it("should allow the author to delete their post", async () => {
		const { accessToken } = await createVerifiedUser(app);

		const communityRes = await supertest(app)
			.post("/api/v1/communities")
			.set("Authorization", `Bearer ${accessToken}`)
			.send({
				name: "DeletePostComm",
				description: "Community for post deletion tests",
			});
		expect(communityRes.status).toBe(201);

		const postRes = await supertest(app)
			.post("/api/v1/posts")
			.set("Authorization", `Bearer ${accessToken}`)
			.send({
				title: "Post to Delete",
				content: "This post will be deleted.",
				type: "TEXT",
				communityId: communityRes.body.data.id,
			});
		expect(postRes.status).toBe(201);
		const postId = postRes.body.data.id;

		const deleteRes = await supertest(app)
			.delete(`/api/v1/posts/${postId}`)
			.set("Authorization", `Bearer ${accessToken}`);

		expect(deleteRes.status).toBe(204);

		const post = await db.post.findUnique({ where: { id: postId } });
		expect(post).not.toBeNull();
		expect(post?.deletedAt).not.toBeNull();
	});

	it("should reject non-author deletions", async () => {
		const author = await createVerifiedUser(app);
		const hacker = await createVerifiedUser(app);

		const communityRes = await supertest(app)
			.post("/api/v1/communities")
			.set("Authorization", `Bearer ${author.accessToken}`)
			.send({
				name: "HackerDelComm",
				description: "Testing unauthorized deletions",
			});
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
			.delete(`/api/v1/posts/${postRes.body.data.id}`)
			.set("Authorization", `Bearer ${hacker.accessToken}`);

		expect(res.status).toBe(403);
		expect(res.body.success).toBe(false);
	});

	it("should reject unauthenticated requests", async () => {
		const res = await supertest(app).delete(
			"/api/v1/posts/00000000-0000-0000-0000-000000000000",
		);

		expect(res.status).toBe(401);
		expect(res.body.success).toBe(false);
	});

	it("should return 404 for missing post", async () => {
		const { accessToken } = await createVerifiedUser(app);

		const res = await supertest(app)
			.delete("/api/v1/posts/00000000-0000-0000-0000-000000000000")
			.set("Authorization", `Bearer ${accessToken}`);

		expect(res.status).toBe(404);
		expect(res.body.success).toBe(false);
	});
});
