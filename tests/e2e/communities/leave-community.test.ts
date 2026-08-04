import { beforeAll, describe, expect, it } from "@jest/globals";
import type { Application } from "express";
import supertest from "supertest";
import { createVerifiedUser } from "../auth.helper.js";
import { getE2EDatabase } from "../test-db.js";
import { getE2EServer } from "../test-server.js";

describe("DELETE /api/v1/communities/:slug/leave", () => {
	let app: Application;
	let db: ReturnType<typeof getE2EDatabase>;

	beforeAll(async () => {
		app = await getE2EServer();
		db = getE2EDatabase();
	});

	it("should allow a member to leave a community", async () => {
		const creator = await createVerifiedUser(app);
		const member = await createVerifiedUser(app);

		const communityRes = await supertest(app)
			.post("/api/v1/communities")
			.set("Authorization", `Bearer ${creator.accessToken}`)
			.send({ name: "LeaveTestComm", description: "A community for leaving" });
		expect(communityRes.status).toBe(201);
		const slug = communityRes.body.data.slug;
		const communityId = communityRes.body.data.id;

		await supertest(app)
			.post(`/api/v1/communities/${slug}/join`)
			.set("Authorization", `Bearer ${member.accessToken}`);

		const leaveRes = await supertest(app)
			.delete(`/api/v1/communities/${slug}/leave`)
			.set("Authorization", `Bearer ${member.accessToken}`);

		expect(leaveRes.status).toBe(200);
		expect(leaveRes.body.success).toBe(true);

		const membership = await db.membership.findFirst({
			where: { userId: member.id, communityId },
		});
		expect(membership).toBeNull();
	});

	it("should reject unauthenticated requests", async () => {
		const res = await supertest(app).delete("/api/v1/communities/test/leave");
		expect(res.status).toBe(401);
		expect(res.body.success).toBe(false);
	});

	it("should return 404 for non-existent community", async () => {
		const { accessToken } = await createVerifiedUser(app);

		const res = await supertest(app)
			.delete("/api/v1/communities/nonexistent/leave")
			.set("Authorization", `Bearer ${accessToken}`);

		expect(res.status).toBe(404);
		expect(res.body.success).toBe(false);
	});
});
