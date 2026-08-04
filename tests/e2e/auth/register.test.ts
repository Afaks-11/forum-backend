import { faker } from "@faker-js/faker";
import { beforeAll, describe, expect, it } from "@jest/globals";
import supertest from "supertest";
import { getE2EDatabase } from "../test-db.js";
import { getE2EServer } from "../test-server.js";

describe("POST /api/v1/auth/register", () => {
	let request: supertest.Agent;
	let db: ReturnType<typeof getE2EDatabase>;

	beforeAll(async () => {
		const app = await getE2EServer();
		request = supertest.agent(app);
		db = getE2EDatabase();
	});

	const generatePayload = () => ({
		username: `e2e_${faker.string.alphanumeric(10).toLowerCase()}`,
		email: faker.internet.email(),
		password: "SecurePassword123!",
	});

	it("should register a new user with valid credentials", async () => {
		const payload = generatePayload();

		const res = await request.post("/api/v1/auth/register").send(payload);

		expect(res.status).toBe(201);
		expect(res.body.success).toBe(true);
		expect(res.body.data).toHaveProperty("id");
		expect(res.body.data.username).toBe(payload.username);
		expect(res.body.data.email).toBe(payload.email);

		const user = await db.user.findUnique({ where: { email: payload.email } });
		expect(user).not.toBeNull();
		expect(user?.password).not.toBe(payload.password);
	});

	it("should reject invalid email format", async () => {
		const res = await request.post("/api/v1/auth/register").send({
			username: generatePayload().username,
			email: "not-an-email",
			password: "SecurePassword123!",
		});

		expect(res.status).toBe(400);
		expect(res.body.success).toBe(false);
	});

	it("should reject short username", async () => {
		const res = await request.post("/api/v1/auth/register").send({
			username: "ab",
			email: faker.internet.email(),
			password: "SecurePassword123!",
		});

		expect(res.status).toBe(400);
		expect(res.body.success).toBe(false);
	});

	it("should reject short password", async () => {
		const res = await request.post("/api/v1/auth/register").send({
			username: generatePayload().username,
			email: faker.internet.email(),
			password: "short",
		});

		expect(res.status).toBe(400);
		expect(res.body.success).toBe(false);
	});

	it("should reject duplicate username", async () => {
		const payload = generatePayload();
		await request.post("/api/v1/auth/register").send(payload);

		const res = await request.post("/api/v1/auth/register").send({
			...payload,
			email: faker.internet.email(),
		});

		expect(res.status).toBe(409);
		expect(res.body.success).toBe(false);
	});

	it("should reject duplicate email", async () => {
		const payload = generatePayload();
		await request.post("/api/v1/auth/register").send(payload);

		const res = await request.post("/api/v1/auth/register").send({
			...payload,
			username: generatePayload().username,
		});

		expect(res.status).toBe(409);
		expect(res.body.success).toBe(false);
	});
});
