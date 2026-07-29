import "dotenv/config";

import { createServer } from "node:http";

import app from "./app.js";
import { env } from "./config/env.config.js";
import { initScheduledJobs } from "./queues/cron.queue.js";
import { initSocketServer } from "./socket/socket.server.js";
import { logger } from "./utils/logger.js";

import "./workers/email.worker.js";
import "./workers/notification.worker.js";
import "./workers/cron.worker.js";
import "./workers/ranking.worker.js";

const PORT = env.app.port;

const httpServer = createServer(app);

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
	const shutdown = async (signal: string) => {
		logger.info(`${signal} received. Shutting down...`);

		httpServer.close((err) => {
			if (err) {
				logger.error({ err }, "Error while closing HTTP server.");
				process.exit(1);
			}

			logger.info("HTTP server closed.");

			process.exit(0);
		});
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
