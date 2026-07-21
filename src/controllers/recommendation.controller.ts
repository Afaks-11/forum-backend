import { asyncHandler } from "../middlewares/asyncHandler.js";
import {
	getRecommendedCommunities,
	getRecommendedPosts,
} from "../services/recommendation.service.js";
import { recommendationQuerySchema } from "../validators/recommendation.validator.js";

export const handleGetCommunityRecommendations = asyncHandler(
	async (req, res) => {
		const parsed = recommendationQuerySchema.parse(req.query);
		const userId = res.locals.user.userId;

		const suggested = await getRecommendedCommunities(userId, parsed.limit);

		res.status(200).json({
			success: true,
			data: suggested,
		});
	},
);

export const handleGetPostRecommendations = asyncHandler(async (req, res) => {
	const parsed = recommendationQuerySchema.parse(req.query);
	const userId = res.locals.user.userId;

	const posts = await getRecommendedPosts(userId, parsed.limit);
	res.status(200).json({
		success: true,
		data: posts,
	});
});
