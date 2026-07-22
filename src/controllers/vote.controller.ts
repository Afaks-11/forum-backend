import type { Request, Response } from "express";
import { z } from "zod";
import { castVote } from "../services/vote.service.js";
import { logger } from "../utils/logger.js";
import { castVoteSchema } from "../validators/vote.validator.js";

export const voteCasting = async (
	req: Request,
	res: Response,
): Promise<void> => {
	try {
		const userId = res.locals.user.userId;
		const validatedData = castVoteSchema.parse(req.body);

		const voteCasted = await castVote(validatedData, userId);
		res.status(200).json({
			success: true,
			data: voteCasted.action,
		});
	} catch (error) {
		if (error instanceof z.ZodError) {
			res.status(400).json({
				success: false,
				message: "Invalid Input Data",
				errors: error.issues.map((issue) => issue.message),
			});
			return;
		}

		if (error instanceof Error) {
			const statusCode = error.message.includes("not found") ? 404 : 400;
			res.status(statusCode).json({
				success: false,
				message: error.message,
			});
			return;
		}

		logger.error({ err: error }, "Failed To Cast Vote: ");
		res.status(500).json({
			success: false,
			message: "Internal Server Error",
		});
		return;
	}
};
