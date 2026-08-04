import type { Application } from "express";
import { getTestApp } from "../helpers/app.js";

/**
 * Returns the Express app for E2E requests.
 *
 * This used to clear the app cache on every call, which re-ran the module
 * resolution for no benefit — Jest already gives each test file its own module
 * registry — and risked building a second app instance (and a second set of
 * queue connections) inside one file.
 */
export async function getE2EServer(): Promise<Application> {
	return getTestApp();
}
