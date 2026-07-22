import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export const traceMiddleware = (
	req: Request,
	res: Response,
	next: NextFunction,
): void => {
	// Check for an existing trace header (propagated from reverse proxies/gateways) or spawn a new one
	const traceId = (req.headers["x-request-id"] as string) || randomUUID();
	res.locals.traceId = traceId;
	res.setHeader("x-request-id", traceId);

	next();
};
