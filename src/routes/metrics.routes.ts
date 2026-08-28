import type { Request, Response } from "express";
import express from "express";
import { queueAuthMiddleware } from "../middlewares/queueAuth.middleware.js";
import { logger } from "../utils/logger.js";
import { register, syncBullMQMetrics } from "../utils/metrics.js";

const router = express.Router();

/**
 * Prometheus scrape endpoint.
 *
 * Guarded with the same constant-time HTTP Basic middleware as the queue
 * dashboard rather than `requireAuth + requireAdmin`
 */
router.get("/", queueAuthMiddleware, async (_req: Request, res: Response) => {
	try {
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
});

export default router;
