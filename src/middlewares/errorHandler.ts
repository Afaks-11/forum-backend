import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { AppError } from "../errors/AppError.js";

export function globalErrorHandler(
	err: unknown,
	_req: Request,
	res: Response,
	_next: NextFunction,
) {
	// validation errors
	if (err instanceof z.ZodError) {
		return res.status(400).json({
			success: false,
			message: "Validation failed",
			errors: err.issues.map((issue) => issue.message),
		});
	}

	// Expected application errors
	if (err instanceof AppError) {
		return res.status(err.statusCode).json({
			success: false,
			message: err.message,
		});
	}

	// Unexpected errors
	console.error(err);
	return res.status(500).json({
		success: false,
		message: "Internal Server Error",
	});
}
