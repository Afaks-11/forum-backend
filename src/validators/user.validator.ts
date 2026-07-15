import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

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

export type UserSearchInput = z.infer<typeof userSearchSchema>;
