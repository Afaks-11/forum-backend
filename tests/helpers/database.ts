import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { getLifecyclePrisma } from "./lifecycle.js";

/**
 * Access the container-bound Prisma client for seeding and assertions.
 *
 * This previously maintained a second, independent connection pool alongside the
 * one in the setup files, so a single worker held two clients against the same
 * database with separate teardown paths. It now delegates to the single client
 * owned by the lifecycle helper.
 */
export function getTestDatabase(): PrismaClient {
	return getLifecyclePrisma();
}

/**
 * Truncates all public tables except `_prisma_migrations`.
 * Exposed for tests that need a mid-test reset; routine per-test isolation is
 * handled by the suite setup files.
 */
export async function truncateTables(prisma: PrismaClient): Promise<void> {
	const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
		SELECT tablename FROM pg_tables WHERE schemaname = 'public'
	`;

	const targetTables = tables
		.map((table) => `"${table.tablename}"`)
		.filter((table) => table !== '"_prisma_migrations"');

	if (targetTables.length === 0) return;

	await prisma.$executeRawUnsafe(
		`TRUNCATE TABLE ${targetTables.join(", ")} CASCADE;`,
	);
}
