import type { RequestHandler } from "express";

/**
 * Forwards rejected promises to Express's error pipeline.
 * Express 5 does not catch async rejections on its own, so without this wrapper
 * a throwing controller would hang the request instead of reaching
 * `globalErrorHandler`.
 */
export const asyncHandler = (fn: RequestHandler): RequestHandler => {
	return (req, res, next) => {
		Promise.resolve(fn(req, res, next)).catch(next);
	};
};
