import { asyncHandler } from "../middlewares/asyncHandler.js";
import { castVote } from "../services/vote.service.js";
import { castVoteSchema } from "../validators/vote.validator.js";

export const voteCasting = asyncHandler(async (req, res) => {
	const userId = res.locals.user.userId;
	const validatedData = castVoteSchema.parse(req.body);
	const voteCasted = await castVote(validatedData, userId);
	res.status(200).json({
		success: true,
		data: voteCasted.action,
	});
});
