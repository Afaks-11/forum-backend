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
	cursor: z.string().optional(), // For Redis ZSET, this is an encoded string index or score
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
	user: compactUserSchema,
	community: compactCommunitySchema,
	_count: z.object({
		comment: z.number().int(),
		votes: z.number().int(),
	}),
});

export type FeedQueryInput = z.infer<typeof feedQuerySchema>;
