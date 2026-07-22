import type { Request, Response } from "express";
import express from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { requireRole } from "../middlewares/role.middleware.js";
import { logger } from "../utils/logger.js";
import { register, syncBullMQMetrics } from "../utils/metrics.js";

const router = express.Router();

router.get(
	"/",
	requireAuth,
	requireRole,
	async (_req: Request, res: Response) => {
		try {
			// Dynamically compile active job totals from Redis right before responding to the scraper
			await syncBullMQMetrics();

			res.setHeader("Content-Type", register.contentType);
			res.send(await register.metrics());
		} catch (error) {
			logger.error(
				{ err: error },
				"Failed to generate Prometheus scrape metrics response payload",
			);
			res.status(500).end();
		}
	},
);

export default router;
