import type { Application } from "express";

let cachedApp: Application | null = null;

export function clearTestAppCache(): void {
	cachedApp = null;
}

export async function getTestApp(): Promise<Application> {
	if (cachedApp) {
		return cachedApp;
	}
	const appModule = (await import("../../src/app.js")) as Record<
		string,
		unknown
	>;
	const appInstance = (appModule.app || appModule.default) as
		| Application
		| undefined;

	if (!appInstance) {
		throw new Error(
			"Express application export 'app' or 'default' could not be found in src/app.js.",
		);
	}

	cachedApp = appInstance;
	return cachedApp;
}
