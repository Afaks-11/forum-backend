import { beforeAll, describe, expect, it } from "@jest/globals";
import type { Application } from "express";
import supertest from "supertest";
import { createVerifiedUser } from "../auth.helper.js";
import { getE2EDatabase } from "../test-db.js";
import { getE2EServer } from "../test-server.js";

describe("POST /api/v1/communities/:slug/join", () => {
	let app: Application;
	let db: ReturnType<typeof getE2EDatabase>;

	beforeAll(async () => {
		app = await getE2EServer();
		db = getE2EDatabase();
	});

	it("should allow an authenticated user to join a community", async () => {
		const creator = await createVerifiedUser(app);
		const joiner = await createVerifiedUser(app);

		const communityRes = await supertest(app)
			.post("/api/v1/communities")
			.set("Authorization", `Bearer ${creator.accessToken}`)
			.send({ name: "JoinTestComm", description: "A community for joining" });
		expect(communityRes.status).toBe(201);
		const slug = communityRes.body.data.slug;

		const joinRes = await supertest(app)
			.post(`/api/v1/communities/${slug}/join`)
			.set("Authorization", `Bearer ${joiner.accessToken}`);

		expect(joinRes.status).toBe(200);
		expect(joinRes.body.success).toBe(true);

		const membership = await db.membership.findFirst({
			where: {
				userId: joiner.id,
				communityId: communityRes.body.data.id,
			},
		});
		expect(membership).not.toBeNull();
	});

	it("should reject unauthenticated requests", async () => {
		const res = await supertest(app).post("/api/v1/communities/test/join");
		expect(res.status).toBe(401);
		expect(res.body.success).toBe(false);
	});

	it("should return 404 for non-existent community", async () => {
		const { accessToken } = await createVerifiedUser(app);

		const res = await supertest(app)
			.post("/api/v1/communities/nonexistent/join")
			.set("Authorization", `Bearer ${accessToken}`);

		expect(res.status).toBe(404);
		expect(res.body.success).toBe(false);
	});
});
