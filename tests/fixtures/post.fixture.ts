import type { Post } from "../../src/generated/prisma/client.js";

/**
 * Represents a Post entity along with its loaded relations and counts.
 */
export type PostWithRelationsFixture = Post & {
	user: {
		username: string;
	};
	community: {
		name: string;
		slug: string;
	};
	_count: {
		comment: number;
		votes: number;
	};
};

/**
 * Simple payload definition structure for community operations.
 */
export interface CommunityPayloadFixture {
	id: string;
	name: string;
	slug: string;
	description: string;
}

/**
 * Generates a post fixture complete with its sub-relation counts.
 * Keeps structural properties intact to preserve unit test stability.
 */
export function createFakePost(
	overrides: Partial<PostWithRelationsFixture> = {},
): PostWithRelationsFixture {
	return {
		id: "post_123",
		title: "Mastering TypeScript Architecture",
		content: "Deep dive into production-ready architecture patterns.",
		authorId: "usr_123",
		communityId: "cmnt_123",
		isLocked: false,
		isPinned: false,
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		updatedAt: new Date("2026-01-01T00:00:00.000Z"),
		deletedAt: null,
		user: { username: "dev_architect" },
		community: { name: "TypeScript", slug: "typescript" },
		_count: { comment: 12, votes: 42 },
		...overrides,
	} as PostWithRelationsFixture;
}

/**
 * Generates community metadata structures for payload validations.
 */
export function createFakeCommunityPayload(
	overrides: Partial<CommunityPayloadFixture> = {},
): CommunityPayloadFixture {
	return {
		id: "cmnt_123",
		name: "TypeScript",
		slug: "typescript",
		description: "A community for TypeScript developers",
		...overrides,
	};
}
