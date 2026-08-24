/**
 * Generates a comment fixture with author and post relations for unit tests.
 */
export function createFakeComment(overrides = {}) {
	return {
		id: "cmnt_789",
		content: "This is an insightful comment about TypeScript.",
		postId: "post_123",
		authorId: "usr_123",
		parentId: null,
		isLocked: false,
		isEdited: false,
		createdAt: new Date(),
		updatedAt: new Date(),
		deletedAt: null,
		author: { id: "usr_123", username: "code_reviewer" },
		...overrides,
	};
}

/**
 * Minimal post metadata for comment service tests that need the parent post.
 */
export function createFakePostPayload(overrides = {}) {
	return {
		id: "post_123",
		title: "Mastering TypeScript Architecture",
		authorId: "usr_owner",
		isLocked: false,
		...overrides,
	};
}
