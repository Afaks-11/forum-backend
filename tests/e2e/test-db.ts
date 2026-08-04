import { getTestDatabase, truncateTables } from "../helpers/database.js";

/**
 * Access the container-bound Prisma client.
 * Valid inside `beforeAll` and test bodies; the E2E setup file initializes it.
 */
export function getE2EDatabase() {
	return getTestDatabase();
}

/**
 * Manual truncation escape hatch. Per-test isolation already runs in the E2E
 * setup's `beforeEach`, so this is only needed for mid-test resets.
 */
export async function resetE2EDatabase(): Promise<void> {
	await truncateTables(getTestDatabase());
}
