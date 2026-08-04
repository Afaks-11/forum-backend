import { beforeAll, describe, expect, it } from "@jest/globals";
import type { Application } from "express";
import supertest from "supertest";
import { getE2EDatabase } from "../test-db.js";
import { getE2EServer } from "../test-server.js";

describe("POST /api/v1/auth/refresh", () => {
	let app: Application;
	let db: ReturnType<typeof getE2EDatabase>;

	beforeAll(async () => {
		app = await getE2EServer();
		db = getE2EDatabase();
	});

	it("should return a new access token with a valid refresh token cookie", async () => {
		const agent = supertest.agent(app);

		await agent.post("/api/v1/auth/register").send({
			username: "refresh_user",
			email: "refresh@e2e.local",
			password: "SecurePassword123!",
		});

		const user = await db.user.findUnique({
			where: { email: "refresh@e2e.local" },
		});
		await agent
			.post("/api/v1/auth/verify-email")
			.send({ token: user?.emailVerifyToken });

		const loginRes = await agent.post("/api/v1/auth/login").send({
			email: "refresh@e2e.local",
			password: "SecurePassword123!",
		});
		expect(loginRes.status).toBe(200);
		expect(loginRes.headers["set-cookie"]).toBeDefined();

		const refreshRes = await agent.post("/api/v1/auth/refresh");

		expect(refreshRes.status).toBe(200);
		expect(refreshRes.body.success).toBe(true);
		expect(refreshRes.body.data).toHaveProperty("accessToken");
	});

	it("should reject request without a refresh token cookie", async () => {
		const res = await supertest(app).post("/api/v1/auth/refresh");

		expect(res.status).toBe(401);
		expect(res.body.success).toBe(false);
	});

	it("should reject an invalid or expired refresh token", async () => {
		const res = await supertest(app)
			.post("/api/v1/auth/refresh")
			.set("Cookie", "refreshToken=invalid.token.here");

		expect(res.status).toBe(401);
		expect(res.body.success).toBe(false);
	});
});
