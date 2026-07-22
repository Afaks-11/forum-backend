import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { AppError } from "../errors/AppError.js";
import { logger } from "../utils/logger.js";

export function globalErrorHandler(
	err: unknown,
	_req: Request,
	res: Response,
	_next: NextFunction,
) {
	const traceId = res.locals.traceId;

	// validation errors
	if (err instanceof z.ZodError) {
		return res.status(400).json({
			success: false,
			message: "Validation failed",
			traceId,
			errors: err.issues.map((issue) => issue.message),
		});
	}

	// Expected application errors
	if (err instanceof AppError) {
		return res.status(err.statusCode).json({
			success: false,
			message: err.message,
			traceId,
		});
	}

	// Unexpected errors
	logger.error(
		{ err, traceId },
		"Unhandled exception caught by global error handler",
	);
	return res.status(500).json({
		success: false,
		message: "Internal Server Error",
		traceId, // Allows customer support to match user tickets with system exceptions instantl
	});
}
