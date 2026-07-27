export function createFakePost(overrides = {}) {
	return {
		id: "post_123",
		title: "Mastering TypeScript Architecture",
		content: "Deep dive into production-ready architecture patterns.",
		authorId: "usr_123",
		communityId: "cmnt_123",
		isLocked: false,
		isPinned: false,
		createdAt: new Date(),
		updatedAt: new Date(),
		deletedAt: null,
		user: { username: "dev_architect" },
		community: { name: "TypeScript", slug: "typescript" },
		_count: { comment: 12, votes: 42 },
		...overrides,
	};
}

export function createFakeCommunityPayload(overrides = {}) {
	return {
		id: "cmnt_123",
		name: "TypeScript",
		slug: "typescript",
		description: "A community for TypeScript developers",
		...overrides,
	};
}
