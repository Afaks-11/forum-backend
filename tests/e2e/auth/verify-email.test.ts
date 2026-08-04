import { beforeAll, describe, expect, it } from "@jest/globals";
import supertest from "supertest";
import { getE2EDatabase } from "../test-db.js";
import { getE2EServer } from "../test-server.js";

describe("POST /api/v1/auth/verify-email", () => {
	let request: supertest.Agent;
	let db: ReturnType<typeof getE2EDatabase>;

	beforeAll(async () => {
		const app = await getE2EServer();
		request = supertest.agent(app);
		db = getE2EDatabase();
	});

	it("should verify a user email with a valid token", async () => {
		const res = await request.post("/api/v1/auth/register").send({
			username: "verify_test_user",
			email: "verify@e2e.local",
			password: "SecurePassword123!",
		});

		expect(res.status).toBe(201);
		const user = await db.user.findUnique({
			where: { email: "verify@e2e.local" },
		});
		expect(user?.emailVerifyToken).not.toBeNull();

		const verifyRes = await request
			.post("/api/v1/auth/verify-email")
			.send({ token: user?.emailVerifyToken });

		expect(verifyRes.status).toBe(200);
		expect(verifyRes.body.success).toBe(true);

		const updated = await db.user.findUnique({
			where: { email: "verify@e2e.local" },
		});
		expect(updated?.isEmailVerified).toBe(true);
	});

	it("should reject an invalid token", async () => {
		const res = await request
			.post("/api/v1/auth/verify-email")
			.send({ token: "invalid-token-1234567890abcdef" });

		expect(res.status).toBe(401);
		expect(res.body.success).toBe(false);
	});

	it("should reject verification of already verified account", async () => {
		await request.post("/api/v1/auth/register").send({
			username: "already_verified",
			email: "already@e2e.local",
			password: "SecurePassword123!",
		});

		const user = await db.user.findUnique({
			where: { email: "already@e2e.local" },
		});

		await request
			.post("/api/v1/auth/verify-email")
			.send({ token: user?.emailVerifyToken });

		const secondAttempt = await request
			.post("/api/v1/auth/verify-email")
			.send({ token: user?.emailVerifyToken });

		expect(secondAttempt.status).toBe(401);
		expect(secondAttempt.body.success).toBe(false);
	});
});
