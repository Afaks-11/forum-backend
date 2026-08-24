import crypto from "node:crypto";
import { beforeAll, describe, expect, it } from "@jest/globals";
import jwt from "jsonwebtoken";
import supertest from "supertest";
import { getTestApp } from "../helpers/app.js";
import { getTestDatabase } from "../helpers/database.js";

let request: supertest.Agent;
let db: ReturnType<typeof getTestDatabase>;
let jwtSecret: string;

describe("Authentication Integration Module", () => {
	beforeAll(async () => {
		const { env } = await import("../../src/config/env.config.js");
		jwtSecret = env.jwt.accessSecret;

		const app = await getTestApp();
		request = supertest(app);
		db = getTestDatabase();
	});

	const generateRegistrationPayload = () => {
		const uniqueId = crypto.randomBytes(4).toString("hex");
		return {
			username: `user_${uniqueId}`,
			email: `engineer_${uniqueId}@forum.com`,
			password: "SecurePassword123!",
		};
	};

	describe("POST /api/v1/auth/register", () => {
		it("should successfully register a new user and hash their password", async () => {
			const payload = generateRegistrationPayload();

			const response = await request
				.post("/api/v1/auth/register")
				.send(payload);

			expect(response.status).toBe(201);
			expect(response.body).toHaveProperty("success", true);

			const databaseUser = await db.user.findUnique({
				where: { email: payload.email },
			});

			expect(databaseUser).not.toBeNull();
			expect(databaseUser?.username).toBe(payload.username);
			expect(databaseUser?.password).not.toBe(payload.password);
		});

		it("should reject registration inputs that violate Zod constraints", async () => {
			const invalidPayload = {
				username: "ab",
				email: "malformed-email-signature",
				password: "short",
			};

			const response = await request
				.post("/api/v1/auth/register")
				.send(invalidPayload);

			expect(response.status).toBe(400);
			expect(response.body).toHaveProperty("success", false);
		});
	});

	describe("POST /api/v1/auth/login", () => {
		it("should log in an existing user and return authentication token schemas", async () => {
			const registrationPayload = generateRegistrationPayload();
			await request.post("/api/v1/auth/register").send(registrationPayload);

			// Activate the dynamically created user account to avoid verification blockades
			await db.user.update({
				where: { email: registrationPayload.email },
				data: { isEmailVerified: true },
			});

			const loginPayload = {
				email: registrationPayload.email,
				password: registrationPayload.password,
			};

			const response = await request
				.post("/api/v1/auth/login")
				.send(loginPayload);

			expect(response.status).toBe(200);
			expect(response.body).toHaveProperty("success", true);

			// Assert inside the data wrapper based on actual runtime contract response
			const { data } = response.body as {
				data: { accessToken: string; user: { email: string } };
			};
			expect(data).toHaveProperty("accessToken");
			expect(data).toHaveProperty("user");
			expect(data.user).toHaveProperty("email", registrationPayload.email);
		});

		it("should reject authentication requests with invalid credentials", async () => {
			const loginPayload = {
				email: "non-existent-user@forum.com",
				password: "WrongPassword123!",
			};

			const response = await request
				.post("/api/v1/auth/login")
				.send(loginPayload);

			expect(response.status).toBe(400);
			expect(response.body).toHaveProperty("success", false);
		});
	});

	describe("GET /api/v1/auth/me", () => {
		it("should grant profile access when a valid JWT access token is present", async () => {
			const mockUserId = crypto.randomUUID();
			const mockEmail = "profile-test@forum.com";

			const mockAccessToken = jwt.sign({ userId: mockUserId }, jwtSecret, {
				expiresIn: "15m",
			});

			await db.user.create({
				data: {
					id: mockUserId,
					username: "profile_tester",
					email: mockEmail,
					password:
						"$2b$10$LwRzXm8/5V3M2D4V6E8R9O.MockHashedBcryptStringPayloadHere",
					isEmailVerified: true,
				},
			});

			const response = await request
				.get("/api/v1/auth/me")
				.set("Authorization", `Bearer ${mockAccessToken}`);

			expect(response.status).toBe(200);
			expect(response.body).toHaveProperty("success", true);

			const { data } = response.body as {
				data: { userProfileDetails: { id: string; email: string } };
			};
			expect(data.userProfileDetails).toHaveProperty("id", mockUserId);
			expect(data.userProfileDetails).toHaveProperty("email", mockEmail);
		});

		it("should deny access and return an unauthorized code if no token is passed", async () => {
			const response = await request.get("/api/v1/auth/me");

			expect(response.status).toBe(401);
			expect(response.body).toHaveProperty("success", false);
		});
	});
});
