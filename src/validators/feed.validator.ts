import { z } from "zod";

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

export type FeedQueryInput = z.infer<typeof feedQuerySchema>;
