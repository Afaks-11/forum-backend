import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { PrismaClient } from "../../src/generated/prisma/client.js";

class TestDatabaseRegistry {
	private static instance: TestDatabaseRegistry | null = null;
	private prismaClient: PrismaClient | null = null;
	private pool: pg.Pool | null = null;

	private constructor() {}

	public static getInstance(): TestDatabaseRegistry {
		if (!TestDatabaseRegistry.instance) {
			TestDatabaseRegistry.instance = new TestDatabaseRegistry();
		}
		return TestDatabaseRegistry.instance;
	}

	/**
	 * Lazily configures and yields the container-bound Prisma Client.
	 */
	public getClient(): PrismaClient {
		if (this.prismaClient) {
			return this.prismaClient;
		}

		const connectionString = process.env.DATABASE_URL;
		if (
			!connectionString ||
			connectionString.includes("localhost:5432/mock_db")
		) {
			throw new Error(
				"Database connection string is uninitialized or pointing to the synchronous mock fallback. " +
					"Ensure this helper is only called inside or after Jest lifecycle execution has begun.",
			);
		}

		// Initialize pg connection pool explicitly for Prisma 7's driver adapter architecture
		this.pool = new pg.Pool({ connectionString });
		// Defensive: ignore PostgreSQL admin-shutdown errors on idle clients during teardown
		this.pool.on("error", (err: Error, _client: pg.PoolClient) => {
			if ((err as NodeJS.ErrnoException).code === "57P01") return;
			console.error("TestDatabaseRegistry pool error:", err);
		});
		const adapter = new PrismaPg(this.pool);

		this.prismaClient = new PrismaClient({
			adapter,
			log:
				process.env.DEBUG_DB === "true"
					? ["query", "error", "warn"]
					: ["error"],
		});

		return this.prismaClient;
	}

	/**
	 * Drains open pools safely to assist teardown hooks if invoked.
	 */
	public async disconnectAll(): Promise<void> {
		if (this.prismaClient) {
			await this.prismaClient.$disconnect();
			this.prismaClient = null;
		}
		if (this.pool) {
			await this.pool.end();
			this.pool = null;
		}
	}

	public async reset(): Promise<void> {
		if (this.prismaClient) {
			await this.prismaClient.$disconnect().catch(() => {});
			this.prismaClient = null;
		}
		if (this.pool) {
			await this.pool.end().catch(() => {});
			this.pool = null;
		}
	}
}

/**
 * Accesses the live container-bound Prisma Client for test setup, data seeding, and assertions.
 */
export function getTestDatabase(): PrismaClient {
	return TestDatabaseRegistry.getInstance().getClient();
}

/**
 * Closes underlying test connection pools programmatically when called.
 */
export async function closeTestDatabase(): Promise<void> {
	await TestDatabaseRegistry.getInstance().disconnectAll();
}

/**
 * Truncates all public tables (except _prisma_migrations) using the provided Prisma client.
 * Call this in a test file's beforeEach to guarantee zero data leakage between tests.
 */
export async function truncateTables(prisma: PrismaClient): Promise<void> {
	const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
		SELECT tablename FROM pg_tables WHERE schemaname = 'public'
	`;
	const targetTables = tables
		.map((t) => `"${t.tablename}"`)
		.filter((name) => name !== '"_prisma_migrations"');

	if (targetTables.length === 0) return;

	await prisma.$executeRawUnsafe(
		`TRUNCATE TABLE ${targetTables.join(", ")} CASCADE;`,
	);
}

export async function resetTestDatabase(): Promise<void> {
	await TestDatabaseRegistry.getInstance().reset();
}
