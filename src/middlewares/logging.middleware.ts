import type { NextFunction, Request, Response } from "express";
import { logger } from "../utils/logger.js";

/**
 * Emits one structured access-log line per request once the response is flushed.
 * Bound on `finish` rather than around `next()` so the logged status code and
 * latency reflect what the client actually received.
 */
export const loggingMiddleware = (
	req: Request,
	res: Response,
	next: NextFunction,
): void => {
	const startTime = process.hrtime();

	res.on("finish", () => {
		const diff = process.hrtime(startTime);
		const responseTimeMs = (diff[0] * 1e3 + diff[1] / 1e6).toFixed(2);

		const traceId = res.locals.traceId;
		const userId = res.locals.user?.userId;

		logger.info({
			msg: "HTTP Request Processed",
			traceId,
			userId,
			method: req.method,
			url: req.originalUrl || req.url,
			statusCode: res.statusCode,
			responseTime: `${responseTimeMs}ms`,
			ip: req.ip,
			userAgent: req.get("user-agent"),
		});
	});

	next();
};
