import { asyncHandler } from "../middlewares/asyncHandler.js";
import { getAdvancedPostsFeed } from "../services/feed.service.js";
import { feedQuerySchema } from "../validators/feed.validator.js";

export const handleGetFeed = asyncHandler(async (req, res) => {
	const parsedFilters = feedQuerySchema.parse(req.query);
	// Mounted behind optional auth so each row can carry the caller's own vote
	// without closing the feed to anonymous readers — the same contract as
	// `GET /posts`, which shares this service.
	const viewerId = res.locals.user?.userId
		? String(res.locals.user.userId)
		: undefined;

	const result = await getAdvancedPostsFeed(parsedFilters, viewerId);

	res.status(200).json({
		success: true,
		data: result.posts,
		meta: {
			nextCursor: result.nextCursor,
		},
	});
});
