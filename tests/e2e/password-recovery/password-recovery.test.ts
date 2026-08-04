import { beforeAll, describe, expect, it } from "@jest/globals";
import type { Application } from "express";
import supertest from "supertest";
import { createVerifiedUser, loginUser } from "../auth.helper.js";
import { getE2EDatabase } from "../test-db.js";
import { getE2EServer } from "../test-server.js";

describe("Password recovery", () => {
	let app: Application;
	let db: ReturnType<typeof getE2EDatabase>;

	beforeAll(async () => {
		app = await getE2EServer();
		db = getE2EDatabase();
	});

	const forgotPassword = (email: string) =>
		supertest(app).post("/api/v1/auth/forgot-password").send({ email });

	const resetPassword = (token: string, newPassword: string) =>
		supertest(app)
			.post("/api/v1/auth/reset-password")
			.send({ token, newPassword });

	describe("POST /api/v1/auth/forgot-password", () => {
		it("issues a reset token for a registered account", async () => {
			const user = await createVerifiedUser(app);

			const res = await forgotPassword(user.email);

			expect(res.status).toBe(200);
			expect(res.body.success).toBe(true);

			const stored = await db.user.findUnique({ where: { id: user.id } });
			expect(stored?.passwordResetToken).toBeTruthy();
			expect(stored?.passwordResetExpires?.getTime()).toBeGreaterThan(
				Date.now(),
			);
		});

		it("returns the same response for an unknown email", async () => {
			// Identical responses prevent the endpoint from being used to
			// enumerate which addresses hold accounts.
			const known = await createVerifiedUser(app);

			const knownRes = await forgotPassword(known.email);
			const unknownRes = await forgotPassword("no-such-user@e2e.local");

			expect(unknownRes.status).toBe(knownRes.status);
			expect(unknownRes.body.message).toBe(knownRes.body.message);
		});

		it("does not create a reset token for an unknown email", async () => {
			await forgotPassword("ghost@e2e.local");

			const stored = await db.user.findUnique({
				where: { email: "ghost@e2e.local" },
			});
			expect(stored).toBeNull();
		});

		it("rejects a malformed email", async () => {
			const res = await forgotPassword("not-an-email");

			expect(res.status).toBe(400);
			expect(res.body.success).toBe(false);
		});
	});

	describe("POST /api/v1/auth/reset-password", () => {
		it("resets the password and clears the token", async () => {
			const user = await createVerifiedUser(app);
			await forgotPassword(user.email);

			const issued = await db.user.findUnique({ where: { id: user.id } });
			const token = issued?.passwordResetToken;
			expect(token).toBeTruthy();

			const res = await resetPassword(token as string, "BrandNewPassword456!");

			expect(res.status).toBe(200);
			expect(res.body.success).toBe(true);

			const stored = await db.user.findUnique({ where: { id: user.id } });
			expect(stored?.passwordResetToken).toBeNull();
			expect(stored?.passwordResetExpires).toBeNull();
			expect(stored?.password).not.toBe(issued?.password);
		});

		it("allows login with the new password and rejects the old one", async () => {
			const user = await createVerifiedUser(app);
			await forgotPassword(user.email);

			const issued = await db.user.findUnique({ where: { id: user.id } });
			await resetPassword(
				issued?.passwordResetToken as string,
				"BrandNewPassword456!",
			);

			const newLogin = await loginUser(app, {
				email: user.email,
				password: "BrandNewPassword456!",
			});
			expect(newLogin.status).toBe(200);
			expect(newLogin.body.data).toHaveProperty("accessToken");

			const oldLogin = await loginUser(app, {
				email: user.email,
				password: user.password,
			});
			expect(oldLogin.status).toBe(400);
		});

		it("rejects a token that has already been used", async () => {
			const user = await createVerifiedUser(app);
			await forgotPassword(user.email);

			const issued = await db.user.findUnique({ where: { id: user.id } });
			const token = issued?.passwordResetToken as string;

			await resetPassword(token, "FirstReplacement123!");
			const res = await resetPassword(token, "SecondReplacement123!");

			expect(res.status).toBe(401);
			expect(res.body.success).toBe(false);
		});

		it("rejects an expired token", async () => {
			const user = await createVerifiedUser(app);
			await forgotPassword(user.email);

			const issued = await db.user.findUnique({ where: { id: user.id } });
			// Move the expiry into the past rather than waiting out the real TTL.
			await db.user.update({
				where: { id: user.id },
				data: { passwordResetExpires: new Date(Date.now() - 60_000) },
			});

			const res = await resetPassword(
				issued?.passwordResetToken as string,
				"BrandNewPassword456!",
			);

			expect(res.status).toBe(401);
			expect(res.body.success).toBe(false);
		});

		it("rejects an unrecognised token", async () => {
			const res = await resetPassword("a".repeat(64), "BrandNewPassword456!");

			expect(res.status).toBe(401);
			expect(res.body.success).toBe(false);
		});

		it("rejects a password shorter than the minimum length", async () => {
			const user = await createVerifiedUser(app);
			await forgotPassword(user.email);

			const issued = await db.user.findUnique({ where: { id: user.id } });

			const res = await resetPassword(
				issued?.passwordResetToken as string,
				"short",
			);

			expect(res.status).toBe(400);
			expect(res.body.success).toBe(false);
		});

		it("rejects a missing token", async () => {
			const res = await supertest(app)
				.post("/api/v1/auth/reset-password")
				.send({ newPassword: "BrandNewPassword456!" });

			expect(res.status).toBe(400);
			expect(res.body.success).toBe(false);
		});
	});
});
