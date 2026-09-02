import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

// Adds `.openapi()` to the shared Zod instance. Repeated per module because
// import order is not guaranteed; the call is idempotent.
extendZodWithOpenApi(z);

export const usernameParamSchema = z.object({
	username: z.string().min(3).openapi({
		description: "The unique username of the target profile",
		example: "johndoe",
	}),
});

export const userProfileResponseSchema = z
	.object({
		id: z.uuid(),
		username: z.string(),
		createdAt: z.date(),
		_count: z.object({
			posts: z.number(),
			comments: z.number(),
			followers: z.number(),
			following: z.number(),
		}),
		isFollowing: z
			.boolean()
			.optional()
			.openapi({ description: "True if the requestor follows this user" }),
	})
	.openapi("UserProfileResponse");

export const standardMessageResponseSchema = z.object({
	success: z.boolean(),
	message: z.string(),
});

export const profilePostItemSchema = z.object({
	id: z.uuid(),
	title: z.string(),
	content: z.string(),
	createdAt: z.date(),
});

export const profileCommentItemSchema = z.object({
	id: z.uuid(),
	content: z.string(),
	postId: z.uuid(),
	createdAt: z.date(),
});

export const userSearchSchema = z.object({
	query: z
		.string()
		.min(1, "Search query cannot be empty")
		.max(100, "Search query is too long")
		.transform((val) => val.trim()),
	limit: z
		.string()
		.optional()
		.transform((val) => (val ? parseInt(val, 10) : 10))
		.pipe(z.number().int().min(1).max(50)),
});

export const savedItemsQuerySchema = z.object({
	limit: z
		.string()
		.optional()
		.transform((value) => (value ? Number.parseInt(value, 10) : 20))
		.pipe(z.number().int().min(1).max(50)),
	cursor: z.uuid().optional(),
});

export const userSearchResultItemSchema = z
	.object({
		id: z.uuid(),
		username: z.string(),
		_count: z.object({
			following: z.number().int(),
			followers: z.number().int(),
			posts: z.number().int(),
			ownedCommunities: z.number().int(),
		}),
	})
	.openapi("UserSearchResultItem");

export const compactUserSchema = z.object({
	username: z.string(),
});

export type UserSearchInput = z.infer<typeof userSearchSchema>;
export type SavedItemsQueryInput = z.infer<typeof savedItemsQuerySchema>;
