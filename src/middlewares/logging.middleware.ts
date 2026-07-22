import type { NextFunction, Request, Response } from "express";
import { logger } from "../utils/logger.js";

export const loggingMiddleware = (
	req: Request,
	res: Response,
	next: NextFunction,
): void => {
	const startTime = process.hrtime();

	res.on("finish", () => {
		const diff = process.hrtime(startTime);
		const responseTimeMs = (diff[0] * 1e3 + diff[1] * 1e6).toFixed(2);

		// Safely extract contextual trace and user bindings compiled during execution
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
