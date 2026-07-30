import type {
	Community,
	Membership,
} from "../../src/generated/prisma/client.js";
import { MembershipRole } from "../../src/generated/prisma/enums.js";

/**
 * Generates a static community data structure for unit testing.
 * Accepts overrides to ensure unique slugs/names during integration runtime.
 */
export function createFakeCommunity(overrides: Partial<Community> = {}) {
	return {
		id: "cmt_123",
		name: "TypeScript",
		slug: "typescript",
		description: "A community for TypeScript developers",
		rules: "Be nice.",
		avatarUrl: null,
		bannerUrl: null,
		creatorId: "usr_123",
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		updatedAt: new Date("2026-01-01T00:00:00.000Z"),
		...overrides,
	};
}

/**
 * Generates a static membership relation matching the default community context.
 */
export function createFakeMembership(overrides: Partial<Membership> = {}) {
	return {
		id: "mem_123",
		userId: "usr_123",
		communityId: "cmnt_123",
		role: MembershipRole.MEMBER,
		joinedAt: new Date("2026-01-01T00:00:00.000Z"),
		...overrides,
	};
}
