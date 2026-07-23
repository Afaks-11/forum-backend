import { z } from "zod";

export const recommendationQuerySchema = z.object({
	limit: z
		.string()
		.optional()
		.transform((val) => (val ? parseInt(val, 10) : 5))
		.pipe(z.number().int().min(1).max(20)),
});

export const recommendedCommunityItemSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	slug: z.string(),
	_count: z.object({
		members: z.number().int(),
		posts: z.number().int(),
	}),
});

export type RecommendationQueryInput = z.infer<
	typeof recommendationQuerySchema
>;
