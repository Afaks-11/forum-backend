import { beforeAll, describe, expect, it } from "@jest/globals";
import supertest from "supertest";
import { getE2EDatabase } from "../test-db.js";
import { getE2EServer } from "../test-server.js";

describe("POST /api/v1/auth/login", () => {
	let request: supertest.Agent;
	let db: ReturnType<typeof getE2EDatabase>;

	beforeAll(async () => {
		const app = await getE2EServer();
		request = supertest.agent(app);
		db = getE2EDatabase();
	});

	it("should log in a verified user and return an access token", async () => {
		await request.post("/api/v1/auth/register").send({
			username: "login_success",
			email: "login@e2e.local",
			password: "SecurePassword123!",
		});

		const user = await db.user.findUnique({
			where: { email: "login@e2e.local" },
		});
		await request
			.post("/api/v1/auth/verify-email")
			.send({ token: user?.emailVerifyToken });

		const res = await request.post("/api/v1/auth/login").send({
			email: "login@e2e.local",
			password: "SecurePassword123!",
		});

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.data).toHaveProperty("accessToken");
		expect(res.body.data.user).toHaveProperty("email", "login@e2e.local");
		expect(res.headers["set-cookie"]).toBeDefined();
	});

	it("should reject login for unverified email", async () => {
		await request.post("/api/v1/auth/register").send({
			username: "unverified_login",
			email: "unverified@e2e.local",
			password: "SecurePassword123!",
		});

		const res = await request.post("/api/v1/auth/login").send({
			email: "unverified@e2e.local",
			password: "SecurePassword123!",
		});

		expect(res.status).toBe(403);
		expect(res.body.success).toBe(false);
	});

	it("should reject invalid credentials", async () => {
		const res = await request.post("/api/v1/auth/login").send({
			email: "nonexistent@e2e.local",
			password: "WrongPassword123!",
		});

		expect(res.status).toBe(400);
		expect(res.body.success).toBe(false);
	});

	it("should reject missing email", async () => {
		const res = await request.post("/api/v1/auth/login").send({
			password: "SecurePassword123!",
		});

		expect(res.status).toBe(400);
		expect(res.body.success).toBe(false);
	});

	it("should reject missing password", async () => {
		const res = await request.post("/api/v1/auth/login").send({
			email: "test@e2e.local",
		});

		expect(res.status).toBe(400);
		expect(res.body.success).toBe(false);
	});
});
