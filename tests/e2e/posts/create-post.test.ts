import { beforeAll, describe, expect, it } from "@jest/globals";
import type { Application } from "express";
import supertest from "supertest";
import { createVerifiedUser } from "../auth.helper.js";
import { getE2EDatabase } from "../test-db.js";
import { getE2EServer } from "../test-server.js";

describe("POST /api/v1/posts", () => {
	let app: Application;
	let db: ReturnType<typeof getE2EDatabase>;

	beforeAll(async () => {
		app = await getE2EServer();
		db = getE2EDatabase();
	});

	it("should create a post in an existing community", async () => {
		const { accessToken } = await createVerifiedUser(app);

		const communityRes = await supertest(app)
			.post("/api/v1/communities")
			.set("Authorization", `Bearer ${accessToken}`)
			.send({ name: "PostTestComm", description: "Community for post tests" });
		expect(communityRes.status).toBe(201);
		const communityId = communityRes.body.data.id;

		const res = await supertest(app)
			.post("/api/v1/posts")
			.set("Authorization", `Bearer ${accessToken}`)
			.send({
				title: "My First Post",
				content: "This is the post content.",
				type: "TEXT",
				communityId,
			});

		expect(res.status).toBe(201);
		expect(res.body.success).toBe(true);
		expect(res.body.data).toHaveProperty("id");
		expect(res.body.data.title).toBe("My First Post");

		const post = await db.post.findUnique({ where: { id: res.body.data.id } });
		expect(post).not.toBeNull();
	});

	it("should reject unauthenticated requests", async () => {
		const res = await supertest(app).post("/api/v1/posts").send({
			title: "Title",
			content: "Content",
			type: "TEXT",
			communityId: "00000000-0000-0000-0000-000000000000",
		});

		expect(res.status).toBe(401);
		expect(res.body.success).toBe(false);
	});

	it("should reject short title", async () => {
		const { accessToken } = await createVerifiedUser(app);

		const communityRes = await supertest(app)
			.post("/api/v1/communities")
			.set("Authorization", `Bearer ${accessToken}`)
			.send({ name: "ShortTitleComm", description: "Testing short titles" });
		expect(communityRes.status).toBe(201);

		const res = await supertest(app)
			.post("/api/v1/posts")
			.set("Authorization", `Bearer ${accessToken}`)
			.send({
				title: "ab",
				content: "Valid content here",
				type: "TEXT",
				communityId: communityRes.body.data.id,
			});

		expect(res.status).toBe(400);
		expect(res.body.success).toBe(false);
	});

	it("should reject non-existent community", async () => {
		const { accessToken } = await createVerifiedUser(app);

		const res = await supertest(app)
			.post("/api/v1/posts")
			.set("Authorization", `Bearer ${accessToken}`)
			.send({
				title: "Valid Title",
				content: "Valid content",
				type: "TEXT",
				communityId: "00000000-0000-0000-0000-000000000000",
			});

		expect(res.status).toBe(404);
		expect(res.body.success).toBe(false);
	});
});
