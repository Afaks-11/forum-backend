import express from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { requireAdmin } from "../middlewares/role.middleware.js";
import { cronQueue } from "../queues/cron.queue.js";
import { getIO } from "../socket/socket.server.js";
import { logger } from "../utils/logger.js";
import { prisma } from "../utils/prisma.js";
import { redis } from "../utils/redis.js";

const router = express.Router();

/**
 * @openapi
 * /health:
 *   get:
 *     description: Returns overall application bootstrap confirmation.
 */
router.get("/", requireAuth, requireAdmin, (_req, res) => {
	res.status(200).json({
		status: "UP",
		timestamp: new Date().toISOString(),
		uptime: process.uptime(),
	});
});

/**
 * @openapi
 * /health/live:
 *   get:
 *     description: Simple liveness probe verifying that the Node runtime event loop is executing.
 */
router.get("/live", (_req, res) => {
	res.status(200).json({ status: "ALIVE" });
});

/**
 * @openapi
 * /health/ready:
 *   get:
 *     description: Deep readiness verification checking all supporting backend infra dependencies.
 */
router.get("/ready", requireAuth, requireAdmin, async (_req, res) => {
	const healthStatus = {
		status: "UP",
		timestamp: new Date().toISOString(),
		services: {
			database: "UP",
			cache: "UP",
			queue: "UP",
			realtime: "UP",
		},
	};

	// Check PostgreSQL Database Integration Layer
	try {
		await prisma.$queryRaw`SELECT 1;`;
	} catch (error) {
		logger.error(
			{ err: error },
			"Readiness check failed for PostgreSQL dtabase layer",
		);
		healthStatus.services.database = "DOWN";
		healthStatus.status = "DOWN";
	}

	// Check ioredis Cache Integration Layer
	try {
		const pingResponse = await redis.getClient().ping();
		if (pingResponse !== "PONG") {
			throw new Error(`Unexpected Redis server ping reaction: ${pingResponse}`);
		}
	} catch (error) {
		logger.error(
			{ err: error },
			"Readiness check failed for Redis cache layer",
		);
		healthStatus.services.cache = "DOWN";
		healthStatus.status = "DOWN";
	}

	// Check BullMQ System Layer via active Repeatable Queue context
	try {
		await cronQueue.getJobCounts();
	} catch (error) {
		logger.error(
			{ err: error },
			"Readiness check failed for BullMQ queue orchestration system",
		);
		healthStatus.services.queue = "DOWN";
		healthStatus.status = "DOWN";
	}

	// Check Socket.IO Engine Layer status
	try {
		const ioInstance = getIO();
		if (!ioInstance?.engine) {
			throw new Error(
				"Socket.IO engine is uninitialized or missing active bindings",
			);
		}
	} catch (error) {
		logger.error(
			{ err: error },
			"Readiness check failed for Socket.IO real-time delivery system",
		);
		healthStatus.services.realtime = "DOWN";
		healthStatus.status = "DOWN";
	}

	const complianceStatusCode = healthStatus.status === "UP" ? 200 : 503;
	res.status(complianceStatusCode).json(healthStatus);
});

export default router;
