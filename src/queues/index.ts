import { closeQueueConnections } from "./connection.js";
import { cronQueue } from "./cron.queue.js";
import { emailQueue } from "./email.queue.js";
import { notificationQueue } from "./notification.queue.js";
import { rankingQueue } from "./ranking.queue.js";

/**
 * Single place that knows about every BullMQ queue in the application.
 *
 * Closing a queue stops its internal schedulers; closing the underlying
 * connections releases the ioredis sockets and their retry timers. Both are
 * required for a clean process exit — otherwise Node keeps the event loop alive
 * and ioredis keeps logging connection errors against a terminated Redis.
 */
export const closeAllQueues = async (): Promise<void> => {
	await Promise.all(
		[emailQueue, notificationQueue, cronQueue, rankingQueue].map((queue) =>
			queue.close().catch(() => {
				// A queue whose connection already dropped throws on close; the
				// connection teardown below is what actually frees the handle.
			}),
		),
	);

	await closeQueueConnections();
};

export { cronQueue, emailQueue, notificationQueue, rankingQueue };
