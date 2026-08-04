import type { Application } from "express";

let cachedApp: Application | null = null;

/**
 * Resolves the Express application for HTTP-level tests.
 *
 * The import is dynamic and deliberately late: `src/app.ts` pulls in the env
 * config, the Redis singleton and every BullMQ queue at module load, so it must
 * not be imported until `setup-env.ts` has published the container endpoints.
 * One instance is reused per worker; Jest's module registry is per test file, so
 * there is no cross-file leakage to guard against.
 */
export async function getTestApp(): Promise<Application> {
	if (cachedApp) return cachedApp;

	const appModule = await import("../../src/app.js");
	const appInstance = appModule.default;

	if (!appInstance) {
		throw new Error(
			"Express application default export not found in src/app.ts.",
		);
	}

	cachedApp = appInstance;
	return cachedApp;
}
