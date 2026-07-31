/** @type {import('jest').Config} */
module.exports = {
	// Do NOT use ts-jest preset. We compile exclusively with @swc/jest.
	testEnvironment: "node",

	extensionsToTreatAsEsm: [".ts"],

	injectGlobals: false,

	setupFiles: ["<rootDir>/tests/setup-env.ts"],

	// CRITICAL: Resolve .js extension imports back to .ts files for ESM.
	moduleNameMapper: {
		"^(\\.{1,2}/.*)\\.js$": "$1",
	},

	// Use @swc/jest. It will automatically read your .swcrc.
	// Do NOT duplicate SWC options here.
	transform: {
		"^.+\\.tsx?$": "@swc/jest",
	},
	testMatch: ["<rootDir>/tests/unit/**/*.test.ts"],

	// Prevent mock state leakage across tests.
	clearMocks: true,
	resetMocks: true,
	restoreMocks: true,

	coverageDirectory: "coverage",
	coverageProvider: "v8",
	collectCoverageFrom: [
		"src/services/**/*.ts",
		"!src/main.ts",
		"!node_modules/**",
	],
	verbose: true,
};
