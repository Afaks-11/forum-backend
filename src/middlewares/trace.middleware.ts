import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { runWithRequestContext } from "../utils/requestContext.js";

/**
 * Assigns every request a trace ID, exposed on `res.locals` and echoed back in
 * the `x-request-id` header so clients can quote it in bug reports.
 *
 * The same ID is also placed in AsyncLocalStorage so code below the HTTP layer
 * — services enqueueing background jobs — can stamp it into job payloads
 * without receiving it as an argument.
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

	runWithRequestContext({ traceId }, () => next());
};
