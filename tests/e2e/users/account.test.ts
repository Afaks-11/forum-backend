import { beforeAll, describe, expect, it } from "@jest/globals";
import type { Application } from "express";
import supertest from "supertest";
import { createVerifiedUser } from "../auth.helper.js";
import { getE2EDatabase } from "../test-db.js";
import { getE2EServer } from "../test-server.js";

/**
 * Covers the authenticated account surface: reading your own profile, updating
 * it, and obtaining a signed avatar upload credential. Public profile reads by
 * username live in `profile.test.ts`.
 */
describe("Account management", () => {
	let app: Application;
	let db: ReturnType<typeof getE2EDatabase>;

	beforeAll(async () => {
		app = await getE2EServer();
		db = getE2EDatabase();
	});

	describe("GET /api/v1/auth/me", () => {
		it("returns the authenticated user's own profile", async () => {
			const user = await createVerifiedUser(app);

			const res = await supertest(app)
				.get("/api/v1/auth/me")
				.set("Authorization", `Bearer ${user.accessToken}`);

			expect(res.status).toBe(200);
			expect(res.body.success).toBe(true);
			expect(res.body.data.userProfileDetails).toMatchObject({
				id: user.id,
				username: user.username,
				email: user.email,
			});
		});

		it("never exposes the password hash", async () => {
			const user = await createVerifiedUser(app);

			const res = await supertest(app)
				.get("/api/v1/auth/me")
				.set("Authorization", `Bearer ${user.accessToken}`);

			expect(res.body.data.userProfileDetails).not.toHaveProperty("password");
		});

		it("rejects unauthenticated access", async () => {
			const res = await supertest(app).get("/api/v1/auth/me");

			expect(res.status).toBe(401);
			expect(res.body.success).toBe(false);
		});

		it("rejects a malformed bearer token", async () => {
			const res = await supertest(app)
				.get("/api/v1/auth/me")
				.set("Authorization", "Bearer not.a.real.token");

			expect(res.status).toBe(401);
			expect(res.body.success).toBe(false);
		});
	});

	describe("PATCH /api/v1/auth/me", () => {
		it("updates the username and persists it", async () => {
			const user = await createVerifiedUser(app);
			const nextUsername = `renamed_${Math.random().toString(36).slice(2, 8)}`;

			const res = await supertest(app)
				.patch("/api/v1/auth/me")
				.set("Authorization", `Bearer ${user.accessToken}`)
				.send({ username: nextUsername });

			expect(res.status).toBe(200);
			expect(res.body.success).toBe(true);
			expect(res.body.data.updatedUserProfileDetails.username).toBe(
				nextUsername,
			);

			const stored = await db.user.findUnique({ where: { id: user.id } });
			expect(stored?.username).toBe(nextUsername);
		});

		it("rejects a username already held by another account", async () => {
			const existing = await createVerifiedUser(app);
			const user = await createVerifiedUser(app);

			const res = await supertest(app)
				.patch("/api/v1/auth/me")
				.set("Authorization", `Bearer ${user.accessToken}`)
				.send({ username: existing.username });

			expect(res.status).toBe(409);
			expect(res.body.success).toBe(false);

			const stored = await db.user.findUnique({ where: { id: user.id } });
			expect(stored?.username).toBe(user.username);
		});

		it("accepts the user's own current username as a no-op", async () => {
			const user = await createVerifiedUser(app);

			const res = await supertest(app)
				.patch("/api/v1/auth/me")
				.set("Authorization", `Bearer ${user.accessToken}`)
				.send({ username: user.username });

			expect(res.status).toBe(200);
		});

		it("rejects a username below the minimum length", async () => {
			const user = await createVerifiedUser(app);

			const res = await supertest(app)
				.patch("/api/v1/auth/me")
				.set("Authorization", `Bearer ${user.accessToken}`)
				.send({ username: "ab" });

			expect(res.status).toBe(400);
			expect(res.body.success).toBe(false);
		});

		it("rejects a username above the maximum length", async () => {
			const user = await createVerifiedUser(app);

			const res = await supertest(app)
				.patch("/api/v1/auth/me")
				.set("Authorization", `Bearer ${user.accessToken}`)
				.send({ username: "u".repeat(21) });

			expect(res.status).toBe(400);
		});

		it("rejects a missing username", async () => {
			const user = await createVerifiedUser(app);

			const res = await supertest(app)
				.patch("/api/v1/auth/me")
				.set("Authorization", `Bearer ${user.accessToken}`)
				.send({});

			expect(res.status).toBe(400);
		});

		it("rejects unauthenticated updates", async () => {
			const res = await supertest(app)
				.patch("/api/v1/auth/me")
				.send({ username: "anonymous_edit" });

			expect(res.status).toBe(401);
		});
	});

	describe("GET /api/v1/upload/signature", () => {
		it("issues a signed credential for an avatar upload", async () => {
			const user = await createVerifiedUser(app);

			const res = await supertest(app)
				.get("/api/v1/upload/signature")
				.query({ folder: "avatars" })
				.set("Authorization", `Bearer ${user.accessToken}`);

			expect(res.status).toBe(200);
			expect(res.body.success).toBe(true);
			expect(res.body.data).toMatchObject({ folder: "avatars" });
			expect(typeof res.body.data.signature).toBe("string");
			expect(typeof res.body.data.timestamp).toBe("number");
			expect(res.body.data).toHaveProperty("cloudName");
			expect(res.body.data).toHaveProperty("apiKey");
		});

		it("never returns the Cloudinary API secret", async () => {
			const user = await createVerifiedUser(app);

			const res = await supertest(app)
				.get("/api/v1/upload/signature")
				.query({ folder: "avatars" })
				.set("Authorization", `Bearer ${user.accessToken}`);

			expect(JSON.stringify(res.body)).not.toContain("mock_api_secret");
		});

		it("rejects a folder outside the allowed set", async () => {
			const user = await createVerifiedUser(app);

			const res = await supertest(app)
				.get("/api/v1/upload/signature")
				.query({ folder: "etc-passwd" })
				.set("Authorization", `Bearer ${user.accessToken}`);

			expect(res.status).toBe(400);
			expect(res.body.success).toBe(false);
		});

		it("rejects a missing folder", async () => {
			const user = await createVerifiedUser(app);

			const res = await supertest(app)
				.get("/api/v1/upload/signature")
				.set("Authorization", `Bearer ${user.accessToken}`);

			expect(res.status).toBe(400);
		});

		it("rejects unauthenticated signature requests", async () => {
			const res = await supertest(app)
				.get("/api/v1/upload/signature")
				.query({ folder: "avatars" });

			expect(res.status).toBe(401);
			expect(res.body.success).toBe(false);
		});
	});
});
