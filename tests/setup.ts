import { execSync } from "node:child_process";
import { afterAll, beforeAll, beforeEach } from "@jest/globals";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { TestContainerOrchestrator } from "./helpers/containers.js";

/**
 * Seed mandatory structural environment variables
 * to satisfy the immediate initialization assertions in `src/config/env.config.ts`.
 */
process.env.NODE_ENV = "test";
process.env.PORT = "3001";
process.env.DATABASE_URL =
	"postgresql://mock_user:mock_pass@localhost:5432/mock_db?schema=public";
process.env.REDIS_URL = "redis://127.0.0.1:6379/0";
process.env.JWT_ACCESS_TOKEN_SECRET =
	"mock_super_secret_access_token_signature_string_123456789";
process.env.JWT_REFRESH_TOKEN_SECRET =
	"mock_super_secret_refresh_token_signature_string_123456789";
process.env.CLOUDINARY_CLOUD_NAME = "mock_cloud_name";
process.env.CLOUDINARY_API_KEY = "mock_api_key";
process.env.CLOUDINARY_API_SECRET = "mock_api_secret";
process.env.BULL_BOARD_USERNAME = "mock_admin";
process.env.BULL_BOARD_PASSWORD = "mock_secure_password";
process.env.SMTP_USER = "test@gmail.com";
process.env.SMTP_PASS = "qetk adss fhsa cnff";
process.env.SMTP_FROM = "Forum Platform Security <test@gmail.com>";

// Defensive: pg-pool throws 57P01 when PostgreSQL shuts down before the pool drains.
// This happens if Testcontainers stops the container while a sibling pool still has idle clients.
process.on("uncaughtException", (err) => {
	if (
		err &&
		typeof err === "object" &&
		"code" in err &&
		(err as { code?: string }).code === "57P01"
	) {
		return; // Swallow PostgreSQL admin shutdown during test teardown
	}
	throw err;
});

process.on("unhandledRejection", (reason) => {
	const err = reason as { code?: string };
	if (err?.code === "57P01") return;
	throw reason;
});

let prismaClientForCleanup: PrismaClient | null = null;
let databasePoolForCleanup: pg.Pool | null = null;
const containerOrchestrator = TestContainerOrchestrator.getInstance();

beforeAll(async () => {
	const clusterInfo = await containerOrchestrator.startCluster();

	process.env.DATABASE_URL = clusterInfo.databaseUrl;
	process.env.REDIS_URL = clusterInfo.redisUrl;

	try {
		execSync("npx prisma db push ", {
			env: { ...process.env },
			stdio: "inherit",
		});
	} catch (error) {
		throw new Error(
			`Failed to deploy Prisma migrations to Testcontainer: ${(error as Error).message}`,
		);
	}

	// Prisma 7 requires explicit driver adapter orchestration
	databasePoolForCleanup = new pg.Pool({
		connectionString: clusterInfo.databaseUrl,
	});
	const adapter = new PrismaPg(databasePoolForCleanup);

	prismaClientForCleanup = new PrismaClient({ adapter });
}, 60000);

beforeEach(async () => {
	if (!prismaClientForCleanup) {
		throw new Error(
			"Prisma clean-up client was not initialized before test execution.",
		);
	}

	// Explicit type safety to guarantee zero implicit 'any' flags
	const tables = await prismaClientForCleanup.$queryRaw<
		Array<{ tablename: string }>
	>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `;

	const targetTables: string[] = tables
		.map((t: { tablename: string }): string => `"${t.tablename}"`)
		.filter((name: string): boolean => name !== '"_prisma_migrations"');

	if (targetTables.length === 0) return;

	const truncationQuery = `TRUNCATE TABLE ${targetTables.join(", ")} CASCADE;`;
	await prismaClientForCleanup.$executeRawUnsafe(truncationQuery);
});

afterAll(async () => {
	if (prismaClientForCleanup) {
		await prismaClientForCleanup.$disconnect();
	}
	if (databasePoolForCleanup) {
		await databasePoolForCleanup.end();
	}
	// Grace period: allow pg-pool to fully release TCP handles before Docker kills Postgres
	await new Promise((resolve) => setTimeout(resolve, 500));
	await containerOrchestrator.stopCluster();
});
