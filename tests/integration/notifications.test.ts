import crypto from "node:crypto";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "@jest/globals";
import supertest from "supertest";
import { getTestApp } from "../helpers/app.js";
import { generateAccessToken } from "../helpers/auth.js";
import {
	closeTestDatabase,
	getTestDatabase,
	truncateTables,
} from "../helpers/database.js";

let request: supertest.Agent;
let db: ReturnType<typeof getTestDatabase>;

beforeAll(async () => {
	const app = await getTestApp();
	request = supertest(app);
	db = getTestDatabase();
});

beforeEach(async () => {
	await truncateTables(db);
});

afterAll(async () => {
	await closeTestDatabase().catch(() => {});
});

const createUser = () =>
	db.user.create({
		data: {
			id: crypto.randomUUID(),
			username: `u_${crypto.randomBytes(4).toString("hex")}`,
			email: `e_${crypto.randomBytes(4).toString("hex")}@t.com`,
			password: "$2b$10$abcdefghijklmnopqrstuvwxyzA1234567890FakeHash",
			isEmailVerified: true,
		},
	});

const createNotification = (recipientId: string, overrides = {}) =>
	db.notification.create({
		data: {
			recipientId,
			type: "COMMENT",
			title: "Test",
			content: "Test content",
			...overrides,
		},
	});

describe("GET /api/v1/notifications", () => {
	it("should list all notifications", async () => {
		const user = await createUser();
		await createNotification(user.id);
		await createNotification(user.id, { title: "Second" });
		const token = await generateAccessToken(user.id);

		const res = await request
			.get("/api/v1/notifications")
			.set("Authorization", `Bearer ${token}`);

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(Array.isArray(res.body.data)).toBe(true);
		expect(res.body.data.length).toBe(2);
	});

	it("should return 401 without auth", async () => {
		const res = await request.get("/api/v1/notifications");
		expect(res.status).toBe(401);
	});
});

describe("GET /api/v1/notifications/unread", () => {
	it("should list only unread notifications", async () => {
		const user = await createUser();
		await createNotification(user.id, { isRead: false });
		await createNotification(user.id, { isRead: true });
		const token = await generateAccessToken(user.id);

		const res = await request
			.get("/api/v1/notifications/unread")
			.set("Authorization", `Bearer ${token}`);

		expect(res.status).toBe(200);
		expect(res.body.data.length).toBe(1);
		expect(res.body.data[0].isRead).toBe(false);
	});
});

describe("PATCH /api/v1/notifications/read-all", () => {
	it("should mark all notifications as read", async () => {
		const user = await createUser();
		await createNotification(user.id, { isRead: false });
		await createNotification(user.id, { isRead: false });
		const token = await generateAccessToken(user.id);

		const res = await request
			.patch("/api/v1/notifications/read-all")
			.set("Authorization", `Bearer ${token}`);

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);

		const unread = await db.notification.findMany({
			where: { recipientId: user.id, isRead: false },
		});
		expect(unread.length).toBe(0);
	});
});

describe("PATCH /api/v1/notifications/:id/read", () => {
	it("should mark single notification as read", async () => {
		const user = await createUser();
		const notification = await createNotification(user.id, { isRead: false });
		const token = await generateAccessToken(user.id);

		const res = await request
			.patch(`/api/v1/notifications/${notification.id}/read`)
			.set("Authorization", `Bearer ${token}`);

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);

		const updated = await db.notification.findUnique({
			where: { id: notification.id },
		});
		expect(updated?.isRead).toBe(true);
	});

	it("should return 403 for another user's notification", async () => {
		const owner = await createUser();
		const hacker = await createUser();
		const notification = await createNotification(owner.id);
		const token = await generateAccessToken(hacker.id);

		const res = await request
			.patch(`/api/v1/notifications/${notification.id}/read`)
			.set("Authorization", `Bearer ${token}`);

		expect(res.status).toBe(403);
	});

	it("should return 404 for missing notification", async () => {
		const user = await createUser();
		const token = await generateAccessToken(user.id);

		const res = await request
			.patch(`/api/v1/notifications/${crypto.randomUUID()}/read`)
			.set("Authorization", `Bearer ${token}`);

		expect(res.status).toBe(404);
	});
});

describe("DELETE /api/v1/notifications/:id", () => {
	it("should delete notification", async () => {
		const user = await createUser();
		const notification = await createNotification(user.id);
		const token = await generateAccessToken(user.id);

		const res = await request
			.delete(`/api/v1/notifications/${notification.id}`)
			.set("Authorization", `Bearer ${token}`);

		expect(res.status).toBe(204);
		const deleted = await db.notification.findUnique({
			where: { id: notification.id },
		});
		expect(deleted).toBeNull();
	});

	it("should return 403 for another user's notification", async () => {
		const owner = await createUser();
		const hacker = await createUser();
		const notification = await createNotification(owner.id);
		const token = await generateAccessToken(hacker.id);

		const res = await request
			.delete(`/api/v1/notifications/${notification.id}`)
			.set("Authorization", `Bearer ${token}`);

		expect(res.status).toBe(403);
	});
});
