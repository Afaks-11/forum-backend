import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { compactCommunitySchema } from "./community.validator.js";
import { compactUserSchema } from "./user.validator.js";

// Adds `.openapi()` to the shared Zod instance. Repeated per module because
// import order is not guaranteed; the call is idempotent.
extendZodWithOpenApi(z);

/**
 * The single query contract for every feed read.
 *
 * `GET /feed` and `GET /posts` are one concept and now share this schema, one
 * service, and one response envelope. They previously disagreed on limit
 * clamping, cursor grammar, and envelope shape while writing to the same
 * `feed:advanced:` cache namespace.
 *
 * Cursor grammar depends on the sort, which is unavoidable because the two paths
 * page differently:
 *   - `hot` / `controversial` without filters read a Redis sorted set, which
 *     addresses by rank, so the cursor is a non-negative integer offset.
 *   - every other path uses SQL keyset pagination, so the cursor is a post UUID.
 * Both forms are accepted here and the service picks the one its path needs; an
 * offset supplied to a keyset path (or vice versa) simply yields the first page
 * rather than an error.
 */
export const feedQuerySchema = z.object({
	sort: z.enum(["new", "top", "hot", "controversial"]).default("new").openapi({
		description: "OPTIONAL: Ranking strategy applied to the page.",
		example: "hot",
	}),
	community: z
		.string()
		.optional()
		.openapi({
			description: "OPTIONAL: Restrict the page to one community slug.",
			example: "typescript",
		})
		.transform((val) => val?.toLowerCase().trim()),
	author: z.string().optional().openapi({
		description: "OPTIONAL: Restrict the page to one author's username.",
		example: "dev_wizard",
	}),
	limit: z
		.string()
		.optional()
		.openapi({
			description: "OPTIONAL: Page size. Clamped to 1-50.",
			example: "10",
		})
		.transform((val) => (val ? parseInt(val, 10) : 10))
		.pipe(z.number().int().min(1).max(50)),
	cursor: z
		.string()
		.optional()
		.openapi({
			description:
				"OPTIONAL: A post UUID for keyset paths, or a non-negative integer offset for the ranked (hot/controversial) path.",
			example: "10",
		})
		.refine(
			(val) =>
				val === undefined ||
				/^[0-9]+$/.test(val) ||
				z.uuid().safeParse(val).success,
			"Cursor must be a post UUID or a non-negative integer offset",
		),
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

export const feedResponseSchema = z
	.object({
		success: z.boolean(),
		data: z.array(feedPostItemSchema),
		meta: z.object({ nextCursor: z.string().nullable() }),
	})
	.openapi("FeedResponse");

export type FeedQueryInput = z.infer<typeof feedQuerySchema>;
