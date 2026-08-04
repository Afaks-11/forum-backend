import { faker } from "@faker-js/faker";
import { beforeAll, describe, expect, it } from "@jest/globals";
import type { Application } from "express";
import supertest from "supertest";
import { createVerifiedUser } from "../auth.helper.js";
import { getE2EDatabase } from "../test-db.js";
import { getE2EServer } from "../test-server.js";

describe("POST /api/v1/communities", () => {
	let app: Application;
	let db: ReturnType<typeof getE2EDatabase>;

	beforeAll(async () => {
		app = await getE2EServer();
		db = getE2EDatabase();
	});

	const generatePayload = () => ({
		name: `E2E-${faker.string.alphanumeric(8)}`,
		description: faker.lorem.sentence(5),
	});

	it("should create a community when authenticated", async () => {
		const { accessToken } = await createVerifiedUser(app);
		const payload = generatePayload();

		const res = await supertest(app)
			.post("/api/v1/communities")
			.set("Authorization", `Bearer ${accessToken}`)
			.send(payload);

		expect(res.status).toBe(201);
		expect(res.body.success).toBe(true);
		expect(res.body.data).toHaveProperty("id");
		expect(res.body.data.name).toBe(payload.name);
		expect(res.body.data.slug).toBe(payload.name.toLowerCase());

		const community = await db.community.findUnique({
			where: { name: payload.name },
		});
		expect(community).not.toBeNull();
		expect(community?.creatorId).toBeDefined();
	});

	it("should reject unauthenticated requests", async () => {
		const res = await supertest(app)
			.post("/api/v1/communities")
			.send(generatePayload());

		expect(res.status).toBe(401);
		expect(res.body.success).toBe(false);
	});

	it("should reject short community name", async () => {
		const { accessToken } = await createVerifiedUser(app);

		const res = await supertest(app)
			.post("/api/v1/communities")
			.set("Authorization", `Bearer ${accessToken}`)
			.send({ name: "ab", description: "Valid description text" });

		expect(res.status).toBe(400);
		expect(res.body.success).toBe(false);
	});

	it("should reject short description", async () => {
		const { accessToken } = await createVerifiedUser(app);

		const res = await supertest(app)
			.post("/api/v1/communities")
			.set("Authorization", `Bearer ${accessToken}`)
			.send({ name: "ValidName", description: "short" });

		expect(res.status).toBe(400);
		expect(res.body.success).toBe(false);
	});

	it("should reject duplicate community name", async () => {
		const { accessToken } = await createVerifiedUser(app);
		const payload = generatePayload();

		const first = await supertest(app)
			.post("/api/v1/communities")
			.set("Authorization", `Bearer ${accessToken}`)
			.send(payload);
		expect(first.status).toBe(201);

		const second = await supertest(app)
			.post("/api/v1/communities")
			.set("Authorization", `Bearer ${accessToken}`)
			.send({ ...payload, description: "Another description here" });

		expect(second.status).toBe(409);
		expect(second.body.success).toBe(false);
	});
});
