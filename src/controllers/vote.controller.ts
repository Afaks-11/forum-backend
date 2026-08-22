import { asyncHandler } from "../middlewares/asyncHandler.js";
import { castVote } from "../services/vote.service.js";
import { castVoteSchema } from "../validators/vote.validator.js";

/**
 * Returns the post's fresh tallies alongside the action taken, so a client can
 * settle its optimistic update from the response instead of refetching the post.
 */
export const voteCasting = asyncHandler(async (req, res) => {
	const userId = res.locals.user.userId;
	const validatedData = castVoteSchema.parse(req.body);
	const result = await castVote(validatedData, userId);
	res.status(200).json({
		success: true,
		data: result,
	});
});
