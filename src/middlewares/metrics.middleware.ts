import type { NextFunction, Request, Response } from "express";
import {
	httpRequestCounter,
	httpRequestDurationHistogram,
} from "../utils/metrics.js";

export const metricsMiddleware = (
	req: Request,
	res: Response,
	next: NextFunction,
): void => {
	// Exclude the metrics endpoint itself to prevent data skew from telemetry scrapes
	if (req.originalUrl === "/metrics" || req.url === "/metrics") {
		next();
	}

	const startTime = process.hrtime();

	res.on("finish", () => {
		const diff = process.hrtime(startTime);
		const durationInSeconds = diff[0] + diff[1] / 1e9;

		// Use the parameterized route string (e.g., /api/v1/posts/:id) if matched to prevent label cardinality explosions
		const routePath = req.route ? req.route.path : req.originalUrl || req.url;
		const method = req.method;
		const statusCode = res.statusCode.toString();

		httpRequestCounter.inc({
			method,
			route: routePath,
			status_code: statusCode,
		});
		httpRequestDurationHistogram.observe(
			{
				method,
				route: routePath,
				status_code: statusCode,
			},
			durationInSeconds,
		);
	});
	next();
};
