import { z } from "zod";
import { compactCommunitySchema } from "./community.validator.js";
import { compactUserSchema } from "./user.validator.js";

export const feedQuerySchema = z.object({
	sort: z.enum(["new", "top", "hot", "controversial"]).default("new"),
	community: z
		.string()
		.optional()
		.transform((val) => val?.toLowerCase().trim())
		.optional(),
	author: z.string().optional(),
	limit: z
		.string()
		.optional()
		.transform((val) => (val ? parseInt(val, 10) : 10))
		.pipe(z.number().int().min(1).max(50)),
	// For Redis ZSET pagination, this is an encoded score or offset token.
	cursor: z.string().optional(),
});

export const feedPostItemSchema = z.object({
	id: z.uuid(),
	title: z.string(),
	content: z.string(),
	createdAt: z.date(),
	deletedAt: z.date().nullable(),
	isLocked: z.boolean(),
	authorId: z.uuid(),
	communityId: z.uuid(),
	author: compactUserSchema,
	community: compactCommunitySchema,
	upvoteCount: z.number().int(),
	downvoteCount: z.number().int(),
	score: z.number().int(),
	currentUserVote: z.enum(["UPVOTE", "DOWNVOTE"]).nullable().optional(),
	_count: z.object({
		comments: z.number().int(),
	}),
});

export type FeedQueryInput = z.infer<typeof feedQuerySchema>;
