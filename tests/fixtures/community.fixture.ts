import { MembershipRole } from "../../src/generated/prisma/enums.js";

export function createFakeCommunity(overrides = {}) {
	return {
		id: "cmt_123",
		name: "TypeScript",
		slug: "typescript",
		description: "A community for TypeScript developers",
		rules: "Be nice.",
		avatarUrl: null,
		bannerUrl: null,
		creatorId: "usr_123",
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides,
	};
}

export function createFakeMembership(overrides = {}) {
	return {
		id: "mem_123",
		userId: "usr_123",
		communityId: "cmnt_123",
		role: MembershipRole.MEMBER,
		joinedAt: new Date(),
		...overrides,
	};
}
