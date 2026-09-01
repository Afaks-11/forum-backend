import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

// Adds `.openapi()` to the shared Zod instance. Repeated per module because
// import order is not guaranteed; the call is idempotent.
extendZodWithOpenApi(z);

export const createPostSchema = z.object({
	title: z
		.string()
		.min(3, "Title must be at least 3 characters long")
		.max(100, "Title cannot exceed 100 characters")
		.openapi({
			description: "REQUIRED: Post title text",
			example: "Why Typescript 5.0 is a game changer",
		}),
	type: z.enum(["TEXT", "LINK"]).openapi({
		description: "REQUIRED: Format classification of post content.",
		example: "TEXT",
	}),
	content: z.string().min(1, "Post cannot be empty").openapi({
		description: "REQUIRED: Main body or hyperlink address string.",
		example: "Let's explore structural sharing...",
	}),
	communityId: z.uuid("Invalid community ID format").openapi({
		description: "REQUIRED: Target community database UUID.",
		example: "a6b7c8d9-e0f1-2345-6789-abcdef123456",
	}),
});

export const updatePostSchema = z
	.object({
		title: z
			.string()
			.min(3)
			.max(100)
			.optional()
			.openapi({ description: "OPTIONAL: Update the headline title." }),
		content: z.string().min(1).optional().openapi({
			description: "OPTIONAL: Update the main structural text content body.",
		}),
	})
	.openapi("UpdatePostInput");

export const postIdParamSchema = z.object({
	id: z.uuid("Invalid post ID target format").openapi({
		description: "REQUIRED: Target post primary key UUID.",
		example: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
	}),
});

export const postVoteParamSchema = z.object({
	id: z.uuid("Invalid post UUID format"),
});

export const postResponseSchema = z
	.object({
		id: z.uuid(),
		title: z.string(),
		type: z.enum(["TEXT", "LINK"]),
		content: z.string(),
		communityId: z.uuid(),
		authorId: z.uuid(),
		isLocked: z.boolean(),
		isPinned: z.boolean(),
		createdAt: z.date(),
		updatedAt: z.date(),
		upvoteCount: z.number().int(),
		downvoteCount: z.number().int(),
		score: z.number().int(),
		currentUserVote: z.enum(["UPVOTE", "DOWNVOTE"]).nullable().optional(),
		_count: z
			.object({
				comments: z.number(),
			})
			.optional(),
	})
	.openapi("PostResponse");

export const postVotesDataSchema = z
	.object({
		upvoteCount: z.number().int(),
		downvoteCount: z.number().int(),
		score: z.number().int(),
		currentUserVote: z.enum(["UPVOTE", "DOWNVOTE"]).nullable(),
	})
	.openapi("PostVotesData");

export const communityIdParamSchema = z.object({
	communityId: z.uuid("Invalid community identifier format"),
});

export const postSearchSchema = z.object({
	query: z
		.string()
		.min(1, "Search query cannot be empty")
		.max(150, "Search query is too long")
		.transform((val) => val.trim()),
	limit: z
		.string()
		.optional()
		.transform((val) => (val ? parseInt(val, 10) : 10))
		.pipe(z.number().int().min(1).max(50)),
	cursor: z.string().optional(),
});

export const lockModerationBodySchema = z
	.object({
		isLocked: z.boolean().optional(),
	})
	.strict();

export const pinModerationBodySchema = z
	.object({
		isPinned: z.boolean(),
	})
	.strict();

export const reportModerationBodySchema = z
	.object({
		reason: z
			.string()
			.trim()
			.min(1, "Report reason cannot be empty")
			.max(1000, "Report reason is too long")
			.optional(),
	})
	.strict();

export const hideModerationBodySchema = z.object({}).strict();

export type PostSearchInput = z.infer<typeof postSearchSchema>;
export type CreatePostInput = z.infer<typeof createPostSchema>;
export type PostIdParamInput = z.infer<typeof postIdParamSchema>;
export type UpdatePostInput = z.infer<typeof updatePostSchema>;
export type CommunityIdParamInput = z.infer<typeof communityIdParamSchema>;
