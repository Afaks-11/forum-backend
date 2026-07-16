import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);

export const createCommentSchema = z.object({
	content: z
		.string()
		.min(1, "Comment cannot be empty")
		.max(1000, "Comment is too long"),
	postId: z.uuid("Invalid post ID format"),
	parentId: z.uuid("Invalid parent comment ID format").optional(),
});

export const updateCommentSchema = z
	.object({
		content: z
			.string()
			.min(1, "Comment content cannot be left empty")
			.max(1000),
	})
	.openapi("UpdateCommentInput");

export const commentIdParamSchema = z.object({
	id: z.uuid("Invalid comment UUID format"),
});

export const commentPostIdParamSchema = z.object({
	postId: z.uuid("Invalid post ID path target format").openapi({
		description:
			"REQUIRED: The unique primary key UUID of the post containing the comments stream.",
		example: "ca711b4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
	}),
});

export const commentResponseSchema = z
	.object({
		id: z.uuid(),
		content: z.string(),
		postId: z.uuid(),
		parentId: z.uuid().nullable(),
		authorId: z.uuid(),
		isLocked: z.boolean(),
		isRemoved: z.boolean(),
		createdAt: z.date(),
		updatedAt: z.date(),
		author: z
			.object({
				username: z.string(),
				avatarUrl: z.string().nullable(),
			})
			.optional(),
	})
	.openapi("CommentResponse");

export type CreateCommentInput = z.infer<typeof createCommentSchema>;
