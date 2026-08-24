import type { Post } from "../../src/generated/prisma/client.js";
import { PostType } from "../../src/generated/prisma/enums.js";

/**
 * Mirrors the shape returned by `postListInclude` in the post repository.
 * Kept structurally identical so a drift in the repository's select surfaces
 * here as a type error rather than as a silently passing test.
 */
export type PostWithRelationsFixture = Post & {
	author: {
		username: string;
	};
	community: {
		name: string;
		slug: string;
	};
	_count: {
		comments: number;
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
 * Vote tallies default to a consistent triple (score === up - down) so tests
 * that assert on ordering are not built on impossible data.
 */
export function createFakePost(
	overrides: Partial<PostWithRelationsFixture> = {},
): PostWithRelationsFixture {
	return {
		id: "post_123",
		title: "Mastering TypeScript Architecture",
		content: "Deep dive into production-ready architecture patterns.",
		type: PostType.TEXT,
		authorId: "usr_123",
		communityId: "cmnt_123",
		isLocked: false,
		isPinned: false,
		upvoteCount: 50,
		downvoteCount: 8,
		score: 42,
		hotScore: 0,
		controversialScore: 0,
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		updatedAt: new Date("2026-01-01T00:00:00.000Z"),
		deletedAt: null,
		author: { username: "dev_architect" },
		community: { name: "TypeScript", slug: "typescript" },
		_count: { comments: 12 },
		...overrides,
	};
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
