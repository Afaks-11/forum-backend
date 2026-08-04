import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { PrismaClient } from "../../src/generated/prisma/client.js";

/**
 * Shared database/cache lifecycle for the Testcontainers-backed suites.
 *
 * Integration and E2E setup files previously carried near-identical copies of
 * this logic (container boot, schema push, truncation, Redis flush, teardown).
 * Containers are now owned by Jest's global setup, so all that remains per
 * worker is a cleanup client and the reset/teardown hooks — defined once here.
 */

let prisma: PrismaClient | null = null;
let pool: pg.Pool | null = null;
let truncatableTables: string[] | null = null;

function requireDatabaseUrl(): string {
	const url = process.env.DATABASE_URL;

	if (!url || url.includes("localhost:5432/mock_db")) {
		throw new Error(
			"DATABASE_URL still points at the placeholder fallback. The Testcontainers " +
				"global setup did not publish its endpoints — check globalSetup in the Jest config.",
		);
	}

	return url;
}

/**
 * Creates the worker-local Prisma client used for seeding and assertions.
 * Safe to call from `beforeAll`; the cluster is already running by then.
 */
export function initTestLifecycle(): PrismaClient {
	if (prisma) return prisma;

	pool = new pg.Pool({ connectionString: requireDatabaseUrl() });

	// 57P01 is PostgreSQL's admin-shutdown notice. It reaches idle clients when
	// the container stops and carries no diagnostic value during teardown.
	pool.on("error", (error: Error) => {
		if ((error as NodeJS.ErrnoException).code === "57P01") return;
		console.error("Test database pool error:", error);
	});

	prisma = new PrismaClient({
		adapter: new PrismaPg(pool),
		log:
			process.env.DEBUG_DB === "true" ? ["query", "error", "warn"] : ["error"],
	});

	return prisma;
}

export function getLifecyclePrisma(): PrismaClient {
	if (!prisma) {
		throw new Error(
			"Test lifecycle has not been initialized. Call initTestLifecycle() in beforeAll.",
		);
	}
	return prisma;
}

/**
 * Restores both datastores to empty between tests.
 *
 * The table list is resolved once and cached — the schema cannot change
 * mid-run, so re-querying `pg_tables` before every test was pure overhead.
 * Flushing Redis also clears rate-limiter counters, which keeps auth-heavy
 * tests deterministic instead of intermittently returning 429.
 */
export async function resetDatastores(): Promise<void> {
	const client = getLifecyclePrisma();

	if (!truncatableTables) {
		const tables = await client.$queryRaw<Array<{ tablename: string }>>`
			SELECT tablename FROM pg_tables WHERE schemaname = 'public'
		`;

		truncatableTables = tables
			.map((table) => `"${table.tablename}"`)
			.filter((table) => table !== '"_prisma_migrations"');
	}

	if (truncatableTables.length > 0) {
		await client.$executeRawUnsafe(
			`TRUNCATE TABLE ${truncatableTables.join(", ")} CASCADE;`,
		);
	}

	const { redis } = await import("../../src/utils/redis.js");
	await redis.flushdb();
}

/**
 * Releases every handle this worker opened.
 *
 * Closing the application's Redis client and BullMQ connections here is the
 * other half of the ECONNREFUSED fix: without it those clients outlive the test
 * file and keep retrying, and Jest cannot exit without `--forceExit`.
 */
export async function teardownTestLifecycle(): Promise<void> {
	const { closeAllQueues } = await import("../../src/queues/index.js");
	await closeAllQueues();

	const { redis } = await import("../../src/utils/redis.js");
	await redis.disconnect();

	if (prisma) {
		await prisma.$disconnect();
		prisma = null;
	}

	if (pool) {
		await pool.end();
		pool = null;
	}

	truncatableTables = null;
}
