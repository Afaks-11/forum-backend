import { jest } from "@jest/globals";

class MockRedis {
	on = jest.fn().mockReturnThis();
	get = jest.fn(() => Promise.resolve(null));
	set = jest.fn(() => Promise.resolve("OK"));
	del = jest.fn(() => Promise.resolve(1));
	exists = jest.fn(() => Promise.resolve(0));
	scan = jest.fn(() => Promise.resolve(["0", []]));
	quit = jest.fn(() => Promise.resolve("OK"));
}

export async function mockCommonModules() {
	await jest.unstable_mockModule("ioredis", () => ({
		__esModule: true,
		Redis: MockRedis,
		default: MockRedis,
	}));

	await jest.unstable_mockModule("bullmq", () => ({
		__esModule: true,
		Queue: jest.fn().mockImplementation(() => ({
			add: jest.fn(() => Promise.resolve({ id: "mock_job_id" })),
			close: jest.fn(() => Promise.resolve()),
		})),
		Worker: jest.fn().mockImplementation(() => ({
			on: jest.fn().mockReturnThis(),
			close: jest.fn(() => Promise.resolve()),
		})),
	}));
}
