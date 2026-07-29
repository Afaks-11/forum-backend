import { execSync } from "node:child_process";
import { afterAll, beforeAll, beforeEach } from "@jest/globals";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { clearTestAppCache } from "./helpers/app.js";
import { TestContainerOrchestrator } from "./helpers/containers.js";
import { resetTestDatabase } from "./helpers/database.js";

process.on("uncaughtException", (err) => {
	if (
		err &&
		typeof err === "object" &&
		"code" in err &&
		(err as { code?: string }).code === "57P01"
	) {
		return;
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
	// CRITICAL: bust the app cache so this file imports a fresh app + redis
	clearTestAppCache();
	await resetTestDatabase();

	const clusterInfo = await containerOrchestrator.startCluster();

	process.env.DATABASE_URL = clusterInfo.databaseUrl;
	process.env.REDIS_URL = clusterInfo.redisUrl;

	// CRITICAL: point the shared Redis singleton to the new container
	const { redis } = await import("../src/utils/redis.js");
	redis.reconnect(clusterInfo.redisUrl);

	// Verify Redis is ready
	const { Redis } = await import("ioredis");
	const redisCheck = new Redis(clusterInfo.redisUrl, {
		maxRetriesPerRequest: 1,
		connectTimeout: 5000,
	});
	await redisCheck.ping();
	redisCheck.disconnect();

	// Push schema
	try {
		execSync("npx prisma db push", {
			env: { ...process.env },
			stdio: "inherit",
		});
		execSync("npx prisma generate", {
			env: { ...process.env },
			stdio: "inherit",
		});
	} catch (error) {
		throw new Error(
			`Failed to deploy Prisma schema to Testcontainer: ${
				(error as Error).message
			}`,
		);
	}

	databasePoolForCleanup = new pg.Pool({
		connectionString: clusterInfo.databaseUrl,
	});
	databasePoolForCleanup.on("error", (err: Error) => {
		if ((err as NodeJS.ErrnoException).code === "57P01") return;
		console.error("TestDatabaseRegistry pool error:", err);
	});

	const adapter = new PrismaPg(databasePoolForCleanup);

	prismaClientForCleanup = new PrismaClient({
		adapter,
		log:
			process.env.DEBUG_DB === "true" ? ["query", "error", "warn"] : ["error"],
	});
}, 60000);

beforeEach(async () => {
	if (!prismaClientForCleanup) {
		throw new Error(
			"Prisma clean-up client was not initialized before test execution.",
		);
	}

	const tables = await prismaClientForCleanup.$queryRaw<
		Array<{ tablename: string }>
	>`
		SELECT tablename
		FROM pg_tables
		WHERE schemaname = 'public'
	`;

	const targetTables = tables
		.map((table) => `"${table.tablename}"`)
		.filter((table) => table !== '"_prisma_migrations"');

	if (targetTables.length === 0) {
		return;
	}

	// Flush Redis if we can reach it (swallow errors from stale clients)
	try {
		const { redis } = await import("../src/utils/redis.js");
		if (redis && typeof redis.flushdb === "function") {
			await redis.flushdb();
		}
	} catch {
		// Redis client may be disconnected; DB truncation is enough
	}

	await prismaClientForCleanup.$executeRawUnsafe(
		`TRUNCATE TABLE ${targetTables.join(", ")} CASCADE;`,
	);
});

afterAll(async () => {
	if (prismaClientForCleanup) {
		await prismaClientForCleanup.$disconnect();
		prismaClientForCleanup = null;
	}

	if (databasePoolForCleanup) {
		await databasePoolForCleanup.end();
		databasePoolForCleanup = null;
	}

	await new Promise((resolve) => setTimeout(resolve, 500));

	// Stop containers so ports don't leak across full suite runs
	await containerOrchestrator.stopCluster();
});
