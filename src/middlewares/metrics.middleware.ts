import type { NextFunction, Request, Response } from "express";
import {
	httpRequestCounter,
	httpRequestDurationHistogram,
} from "../utils/metrics.js";

/**
 * Records request count and duration into the Prometheus registry.
 */
export const metricsMiddleware = (
	req: Request,
	res: Response,
	next: NextFunction,
) => {
	if (req.originalUrl === "/metrics" || req.url === "/metrics") {
		return next();
	}

	const startTime = process.hrtime();

	res.on("finish", () => {
		const diff = process.hrtime(startTime);
		const durationInSeconds = diff[0] + diff[1] / 1e9;

		// Label with the parameterized route (/api/v1/posts/:id) when Express
		// matched one; raw URLs would create a new time series per post ID and
		// blow up label cardinality.
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
