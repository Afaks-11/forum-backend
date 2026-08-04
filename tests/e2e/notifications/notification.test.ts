import { beforeAll, describe, expect, it } from "@jest/globals";
import type { Application } from "express";
import supertest from "supertest";
import { createVerifiedUser } from "../auth.helper.js";
import { getE2EDatabase } from "../test-db.js";
import { getE2EServer } from "../test-server.js";

describe("Notifications", () => {
	let app: Application;
	let db: ReturnType<typeof getE2EDatabase>;

	beforeAll(async () => {
		app = await getE2EServer();
		db = getE2EDatabase();
	});

	/**
	 * Notifications are written by the BullMQ notification worker, which is not
	 * running under test. Seeding rows directly keeps these specs focused on the
	 * read/mark-as-read HTTP contract rather than on queue delivery timing, which
	 * would otherwise make them slow and flaky.
	 */
	const seedNotification = (
		recipientId: string,
		overrides: { isRead?: boolean; title?: string } = {},
	) =>
		db.notification.create({
			data: {
				recipientId,
				type: "COMMENT",
				title: overrides.title ?? "You have a new comment",
				content: "Someone replied to your post.",
				isRead: overrides.isRead ?? false,
			},
		});

	describe("GET /api/v1/notifications", () => {
		it("returns the recipient's notifications newest first", async () => {
			const user = await createVerifiedUser(app);
			await seedNotification(user.id, { title: "older" });
			await seedNotification(user.id, { title: "newer" });

			const res = await supertest(app)
				.get("/api/v1/notifications")
				.set("Authorization", `Bearer ${user.accessToken}`);

			expect(res.status).toBe(200);
			expect(res.body.success).toBe(true);
			expect(res.body.data).toHaveLength(2);

			const timestamps = (res.body.data as Array<{ createdAt: string }>).map(
				(item) => new Date(item.createdAt).getTime(),
			);
			expect(timestamps[0]).toBeGreaterThanOrEqual(timestamps[1] as number);
		});

		it("returns an empty list when there are no notifications", async () => {
			const user = await createVerifiedUser(app);

			const res = await supertest(app)
				.get("/api/v1/notifications")
				.set("Authorization", `Bearer ${user.accessToken}`);

			expect(res.status).toBe(200);
			expect(res.body.data).toEqual([]);
		});

		it("never leaks another user's notifications", async () => {
			const owner = await createVerifiedUser(app);
			const stranger = await createVerifiedUser(app);
			await seedNotification(owner.id);

			const res = await supertest(app)
				.get("/api/v1/notifications")
				.set("Authorization", `Bearer ${stranger.accessToken}`);

			expect(res.status).toBe(200);
			expect(res.body.data).toEqual([]);
		});

		it("rejects unauthenticated access", async () => {
			const res = await supertest(app).get("/api/v1/notifications");

			expect(res.status).toBe(401);
			expect(res.body.success).toBe(false);
		});
	});

	describe("GET /api/v1/notifications/unread", () => {
		it("returns only unread notifications", async () => {
			const user = await createVerifiedUser(app);
			await seedNotification(user.id, { isRead: true, title: "read" });
			await seedNotification(user.id, { isRead: false, title: "unread" });

			const res = await supertest(app)
				.get("/api/v1/notifications/unread")
				.set("Authorization", `Bearer ${user.accessToken}`);

			expect(res.status).toBe(200);
			expect(res.body.data).toHaveLength(1);
			expect(res.body.data[0].title).toBe("unread");
		});

		it("rejects unauthenticated access", async () => {
			const res = await supertest(app).get("/api/v1/notifications/unread");

			expect(res.status).toBe(401);
		});
	});

	describe("PATCH /api/v1/notifications/:id/read", () => {
		it("marks a single notification as read", async () => {
			const user = await createVerifiedUser(app);
			const notification = await seedNotification(user.id);

			const res = await supertest(app)
				.patch(`/api/v1/notifications/${notification.id}/read`)
				.set("Authorization", `Bearer ${user.accessToken}`);

			expect(res.status).toBe(200);
			expect(res.body.success).toBe(true);

			const stored = await db.notification.findUnique({
				where: { id: notification.id },
			});
			expect(stored?.isRead).toBe(true);
		});

		it("does not let a stranger mark someone else's notification as read", async () => {
			const owner = await createVerifiedUser(app);
			const stranger = await createVerifiedUser(app);
			const notification = await seedNotification(owner.id);

			const res = await supertest(app)
				.patch(`/api/v1/notifications/${notification.id}/read`)
				.set("Authorization", `Bearer ${stranger.accessToken}`);

			expect(res.status).toBeGreaterThanOrEqual(400);

			const stored = await db.notification.findUnique({
				where: { id: notification.id },
			});
			expect(stored?.isRead).toBe(false);
		});

		it("returns an error for a notification that does not exist", async () => {
			const user = await createVerifiedUser(app);

			const res = await supertest(app)
				.patch(
					"/api/v1/notifications/00000000-0000-0000-0000-000000000000/read",
				)
				.set("Authorization", `Bearer ${user.accessToken}`);

			expect(res.status).toBeGreaterThanOrEqual(400);
			expect(res.body.success).toBe(false);
		});

		it("rejects a malformed notification id", async () => {
			const user = await createVerifiedUser(app);

			const res = await supertest(app)
				.patch("/api/v1/notifications/not-a-uuid/read")
				.set("Authorization", `Bearer ${user.accessToken}`);

			expect(res.status).toBe(400);
			expect(res.body.success).toBe(false);
		});

		it("rejects unauthenticated access", async () => {
			const owner = await createVerifiedUser(app);
			const notification = await seedNotification(owner.id);

			const res = await supertest(app).patch(
				`/api/v1/notifications/${notification.id}/read`,
			);

			expect(res.status).toBe(401);
		});
	});

	describe("PATCH /api/v1/notifications/read-all", () => {
		it("marks every unread notification as read", async () => {
			const user = await createVerifiedUser(app);
			await seedNotification(user.id);
			await seedNotification(user.id);

			const res = await supertest(app)
				.patch("/api/v1/notifications/read-all")
				.set("Authorization", `Bearer ${user.accessToken}`);

			expect(res.status).toBe(200);
			expect(res.body.success).toBe(true);

			const remaining = await db.notification.count({
				where: { recipientId: user.id, isRead: false },
			});
			expect(remaining).toBe(0);
		});

		it("leaves other users' notifications untouched", async () => {
			const user = await createVerifiedUser(app);
			const other = await createVerifiedUser(app);
			await seedNotification(user.id);
			await seedNotification(other.id);

			await supertest(app)
				.patch("/api/v1/notifications/read-all")
				.set("Authorization", `Bearer ${user.accessToken}`);

			const otherUnread = await db.notification.count({
				where: { recipientId: other.id, isRead: false },
			});
			expect(otherUnread).toBe(1);
		});

		it("succeeds when there is nothing to mark", async () => {
			const user = await createVerifiedUser(app);

			const res = await supertest(app)
				.patch("/api/v1/notifications/read-all")
				.set("Authorization", `Bearer ${user.accessToken}`);

			expect(res.status).toBe(200);
		});

		it("rejects unauthenticated access", async () => {
			const res = await supertest(app).patch("/api/v1/notifications/read-all");

			expect(res.status).toBe(401);
		});
	});
});
