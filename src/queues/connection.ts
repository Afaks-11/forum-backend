import { Redis } from "ioredis";
import { env } from "../config/env.config.js";

/**
 * Every connection handed to a BullMQ Queue or Worker is tracked here.
 *
 * BullMQ never owns the lifecycle of a connection it did not create, so without
 * this registry the process has no way to close them. That leaks ioredis clients
 * on shutdown (production) and leaves clients retrying against a dead endpoint
 * after Testcontainers stops Redis (tests).
 */
const activeConnections = new Set<Redis>();

export const createQueueConnection = (): Redis => {
	const connection = new Redis(env.redis.url, {
		// BullMQ requires null: blocking commands (BRPOPLPUSH) must not time out.
		maxRetriesPerRequest: null,
	});

	activeConnections.add(connection);
	connection.once("end", () => activeConnections.delete(connection));

	return connection;
};

/**
 * Gracefully drain and close every queue/worker connection created by this module.
 *
 * `quit()` flushes pending commands before closing; if the endpoint is already
 * gone we fall back to `disconnect()` so the socket and its retry timer are
 * released rather than reconnecting forever.
 */
export const closeQueueConnections = async (): Promise<void> => {
	const connections = [...activeConnections];
	activeConnections.clear();

	await Promise.all(
		connections.map(async (connection) => {
			try {
				await connection.quit();
			} catch {
				connection.disconnect();
			}
		}),
	);
};
