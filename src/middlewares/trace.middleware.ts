import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/**
 * Assigns every request a trace ID, exposed on `res.locals` and echoed back in
 * the `x-request-id` header so clients can quote it in bug reports.
 */
export const traceMiddleware = (
	req: Request,
	res: Response,
	next: NextFunction,
): void => {
	// An inbound header is reused when present so a trace started at the gateway
	// stays continuous instead of being split into two unrelated IDs.
	const traceId = (req.headers["x-request-id"] as string) || randomUUID();
	res.locals.traceId = traceId;
	res.setHeader("x-request-id", traceId);

	next();
};
