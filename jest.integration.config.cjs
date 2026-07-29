/** @type {import('jest').Config} */
module.exports = {
	testEnvironment: "node",
	extensionsToTreatAsEsm: [".ts"],
	injectGlobals: false,
	setupFiles: ["<rootDir>/tests/setup-env.ts"],
	setupFilesAfterEnv: ["<rootDir>/tests/setup-integration.ts"],

	moduleNameMapper: {
		"^(\\.{1,2}/.*)\\.js$": "$1",
	},

	// FIX: allow @testcontainers ESM through
	transformIgnorePatterns: [
		"/node_modules/(?!(@prisma|@asteasolutions|@testcontainers)/)",
	],

	transform: {
		"^.+\\.[tj]sx?$": "@swc/jest",
		"^.+\\.mjs$": "@swc/jest",
	},

	testMatch: ["<rootDir>/tests/integration/**/*.test.ts"],
	maxWorkers: 1,

	clearMocks: true,
	resetMocks: false,
	restoreMocks: false,

	coverageDirectory: "coverage/integration",
	coverageProvider: "v8",
	verbose: true,
	testTimeout: 60000,
};
