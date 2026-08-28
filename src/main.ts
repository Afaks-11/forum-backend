import "dotenv/config";

import { createServer } from "node:http";

import app from "./app.js";
import { env } from "./config/env.config.js";
import { initScheduledJobs } from "./queues/cron.queue.js";
import { closeAllQueues } from "./queues/index.js";
import { initSocketServer } from "./socket/socket.server.js";
import { logger } from "./utils/logger.js";
import { prisma } from "./utils/prisma.js";
import { redis } from "./utils/redis.js";

import "./workers/email.worker.js";
import "./workers/notification.worker.js";
import "./workers/cron.worker.js";
import "./workers/ranking.worker.js";

const PORT = env.app.port;

const httpServer = createServer(app);

// Node's defaults (300s request timeout, 60s headers timeout) are far more
// generous than any endpoint here needs. Tightening them means a stalled or
// slow-loris client releases its socket instead of occupying a connection for
// five minutes, and pairs with the database timeouts in `utils/prisma.ts` so no
// layer waits without bound.
httpServer.requestTimeout = 30_000;
httpServer.headersTimeout = 15_000;
httpServer.keepAliveTimeout = 20_000;

async function bootstrap() {
	try {
		initSocketServer(httpServer);
		logger.info("Socket.IO initialized.");

		await initScheduledJobs();
		logger.info("Scheduled jobs initialized.");

		httpServer.listen(PORT, () => {
			logger.info(`Server running on http://localhost:${PORT}`);
			logger.info(`Swagger Docs: http://localhost:${PORT}/api-docs`);
		});

		registerShutdown();
	} catch (error) {
		logger.fatal({ err: error }, "Application failed to start.");

		process.exit(1);
	}
}

function registerShutdown() {
	// Orchestrators often send SIGTERM followed by SIGINT; the guard keeps a
	// second signal from tearing down connections mid-drain.
	let shuttingDown = false;

	/**
	 * Close resources in dependency order: stop accepting traffic, then drain
	 * background work, then release the datastores.
	 */
	const shutdown = async (signal: string) => {
		if (shuttingDown) return;
		shuttingDown = true;

		logger.info(`${signal} received. Shutting down...`);

		// Force exit if a hung connection prevents graceful teardown.
		const forceExit = setTimeout(() => {
			logger.error("Graceful shutdown timed out. Forcing exit.");
			process.exit(1);
		}, 10_000);
		forceExit.unref();

		try {
			await new Promise<void>((resolve, reject) => {
				httpServer.close((err) => (err ? reject(err) : resolve()));
			});
			logger.info("HTTP server closed.");

			await closeAllQueues();
			logger.info("Queue connections closed.");

			await redis.disconnect();
			logger.info("Redis connection closed.");

			await prisma.$disconnect();
			logger.info("Database connection closed.");

			clearTimeout(forceExit);
			process.exit(0);
		} catch (error) {
			logger.error({ err: error }, "Error during graceful shutdown.");
			process.exit(1);
		}
	};

	process.on("SIGINT", () => void shutdown("SIGINT"));
	process.on("SIGTERM", () => void shutdown("SIGTERM"));

	process.on("uncaughtException", (err) => {
		logger.fatal({ err }, "Uncaught Exception");
		process.exit(1);
	});

	process.on("unhandledRejection", (reason) => {
		logger.fatal({ err: reason }, "Unhandled Promise Rejection");
		process.exit(1);
	});
}

void bootstrap();
