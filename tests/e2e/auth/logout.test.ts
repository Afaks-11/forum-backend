import { beforeAll, describe, expect, it } from "@jest/globals";
import type { Application } from "express";
import supertest from "supertest";
import { getE2EDatabase } from "../test-db.js";
import { getE2EServer } from "../test-server.js";

describe("POST /api/v1/auth/logout", () => {
	let app: Application;
	let db: ReturnType<typeof getE2EDatabase>;

	beforeAll(async () => {
		app = await getE2EServer();
		db = getE2EDatabase();
	});

	it("should log out an authenticated user and clear the refresh token cookie", async () => {
		const agent = supertest.agent(app);

		await agent.post("/api/v1/auth/register").send({
			username: "logout_user",
			email: "logout@e2e.local",
			password: "SecurePassword123!",
		});

		const user = await db.user.findUnique({
			where: { email: "logout@e2e.local" },
		});
		await agent
			.post("/api/v1/auth/verify-email")
			.send({ token: user?.emailVerifyToken });

		const loginRes = await agent.post("/api/v1/auth/login").send({
			email: "logout@e2e.local",
			password: "SecurePassword123!",
		});
		expect(loginRes.status).toBe(200);

		const logoutRes = await agent.post("/api/v1/auth/logout");

		expect(logoutRes.status).toBe(200);
		expect(logoutRes.body.success).toBe(true);
		expect(logoutRes.headers["set-cookie"]).toBeDefined();

		// After logout, the refresh token should be rejected
		const refreshRes = await agent.post("/api/v1/auth/refresh");
		expect(refreshRes.status).toBe(401);
		expect(refreshRes.body.success).toBe(false);
	});

	it("should return success even without an active session", async () => {
		const res = await supertest(app).post("/api/v1/auth/logout");

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
	});
});
