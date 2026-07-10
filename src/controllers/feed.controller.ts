import { asyncHandler } from "../middleware/asyncHandler.js";
import { getAdvancedPostsFeed } from "../services/feed.service.js";
import { feedQuerySchema } from "../validators/feed.validator.js";

export const handleGetFeed = asyncHandler(async (req, res) => {
	const parsedFilters = feedQuerySchema.parse(req.query);
	const result = await getAdvancedPostsFeed(parsedFilters);

	res.status(200).json({
		success: true,
		data: result.posts,
		meta: {
			nextCursor: result.nextCursor,
		},
	});
});
