import { jest } from "@jest/globals";

// Reusable dynamic method factory for Prisma's API signatures
const createMockPrismaMethod = () =>
	jest
		.fn<(...args: unknown[]) => Promise<unknown>>()
		.mockImplementation(() => Promise.resolve([] as unknown as never));

export const createMockPrismaClient = () => ({
	user: {
		findUnique: createMockPrismaMethod(),
		findFirst: createMockPrismaMethod(),
		create: createMockPrismaMethod(),
		update: createMockPrismaMethod(),
		delete: createMockPrismaMethod(),
	},
	$transaction: jest
		.fn<(cb: (tx: unknown) => Promise<unknown>) => Promise<unknown>>()
		.mockImplementation(async (cb) => {
			// Automatically injects a scoped transaction context handler callback
			const mockTxContext = {
				user: {
					findUnique: createMockPrismaMethod(),
					update: createMockPrismaMethod(),
				},
			};
			return cb(mockTxContext);
		}),
});
