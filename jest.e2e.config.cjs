/** @type {import('jest').Config} */
module.exports = {
	testEnvironment: "node",
	extensionsToTreatAsEsm: [".ts"],
	injectGlobals: false,

	// Boot one PostgreSQL + Redis cluster for the entire run instead of one per
	// test file. Per-file clusters were the root cause of the recurring
	// ECONNREFUSED errors against stale dynamic ports.
	globalSetup: "<rootDir>/tests/global-setup.ts",
	globalTeardown: "<rootDir>/tests/global-teardown.ts",

	setupFiles: ["<rootDir>/tests/setup-env.ts"],
	setupFilesAfterEnv: ["<rootDir>/tests/e2e/setup.ts"],

	moduleNameMapper: {
		"^(\\.{1,2}/.*)\\.js$": "$1",
	},

	transformIgnorePatterns: [
		"/node_modules/(?!(@prisma|@asteasolutions|@testcontainers)/)",
	],

	transform: {
		"^.+\\.[tj]sx?$": "@swc/jest",
		"^.+\\.mjs$": "@swc/jest",
	},

	testMatch: ["<rootDir>/tests/e2e/**/*.test.ts"],

	// Shared containers and a truncating reset make parallel workers unsafe.
	maxWorkers: 1,

	clearMocks: true,
	resetMocks: false,
	restoreMocks: false,

	coverageDirectory: "coverage/e2e",
	coverageProvider: "v8",
	verbose: true,
	testTimeout: 60000,
};
