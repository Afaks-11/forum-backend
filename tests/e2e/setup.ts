import { afterAll, beforeAll, beforeEach } from "@jest/globals";
import {
	initTestLifecycle,
	resetDatastores,
	teardownTestLifecycle,
} from "../helpers/lifecycle.js";

/**
 * Per-worker lifecycle for the E2E suite.
 *
 * Identical in shape to the integration setup by design: both delegate to the
 * shared lifecycle helper so there is one implementation of reset and teardown.
 */
beforeAll(() => {
	initTestLifecycle();
});

beforeEach(async () => {
	await resetDatastores();
});

afterAll(async () => {
	await teardownTestLifecycle();
});
