import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

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

export const postFeedQuerySchema = z.object({
	sort: z
		.enum(["new", "top", "hot", "controversial"])
		.optional()
		.default("new")
		.openapi({
			description: "OPTIONAL: Reorder feed items based on statistical metrics.",
		}),
	community: z.string().optional().openapi({
		description:
			"OPTIONAL: Filter down to specific community workspace by its slug value.",
		example: "nodejs",
	}),
	author: z.string().optional().openapi({
		description:
			"OPTIONAL: Filter down to a single user account profile by their username string.",
		example: "johndoe",
	}),
	cursor: z.uuid().optional().openapi({
		description:
			"OPTIONAL: Database primary key UUID token for high-performance keyset pagination offsets.",
		example: "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
	}),
	limit: z.string().optional().default("10").openapi({
		description:
			"OPTIONAL: Max records capacity count inside a single network response page.",
		example: "10",
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
		isHidden: z.boolean(),
		createdAt: z.date(),
		updatedAt: z.date(),
		_count: z
			.object({
				comments: z.number(),
				votes: z.number(),
			})
			.optional(),
	})
	.openapi("PostResponse");

export const postFeedResponseSchema = z
	.object({
		posts: z.array(postResponseSchema),
		nextCursor: z.uuid().nullable(),
	})
	.openapi("PostFeedResponse");

export const postVotesDataSchema = z
	.object({
		upvotes: z.number(),
		downvotes: z.number(),
		userVote: z.enum(["UPVOTE", "DOWNVOTE"]).nullable(),
	})
	.openapi("PostVotesData");

export const communityIdParamSchema = z.object({
	communityId: z.uuid("Invalid community identifier format"),
});

export const getAdvancedPostsFeedSchema = z.object({
	sort: z.enum(["new", "top", "hot", "controversial"]).optional(),
	community: z.string().optional(),
	author: z.string().optional(),
	cursor: z.uuid().optional(),
	limit: z.number().int().positive().optional(),
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

export type PostSearchInput = z.infer<typeof postSearchSchema>;
export type CreatePostInput = z.infer<typeof createPostSchema>;
export type PostIdParamInput = z.infer<typeof postIdParamSchema>;
export type updatePostInput = z.infer<typeof updatePostSchema>;
export type communityIdParamInput = z.infer<typeof communityIdParamSchema>;
export type getAdvancedPostsFeedInput = z.infer<
	typeof getAdvancedPostsFeedSchema
>;
