import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { AppError } from "../errors/AppError.js";
import { logger } from "../utils/logger.js";

/**
 * Catches all exceptions and serializes them into a consistent JSON response.
 * ZodError validation failures become 400, AppError uses its own status, and
 * everything else becomes a logged 500.
 * The trace ID lets support match a user's report to the logged exception.
 */
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

	// Unexpected errors are logged in full but answered generically: internal
	// messages and stack traces must not reach the client.
	logger.error(
		{ err, traceId },
		"Unhandled exception caught by global error handler",
	);
	return res.status(500).json({
		success: false,
		message: "Internal Server Error",
		traceId,
	});
}
