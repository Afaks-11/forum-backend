import { type Job, Worker } from "bullmq";
import { createQueueConnection } from "../queues/connection.js";
import type { NotificationJobData } from "../queues/notification.queue.js";
import { notificationRepository } from "../repositories/index.js";
import { getIO } from "../socket/socket.server.js";
import { logger } from "../utils/logger.js";

/**
 * Persists each queued notification, then attempts a realtime push.
 * The database write happens first so the notification survives even when no
 * socket server is reachable; the emit is a best-effort optimization on top.
 */
export const notificationWorker = new Worker<NotificationJobData>(
	"notification-queue",
	async (job: Job<NotificationJobData>) => {
		const payload = job.data;

		// Acting on your own content should not notify you.
		if (payload.senderId === payload.recipientId) {
			return;
		}

		const createdNotification = await notificationRepository.create({
			recipientId: payload.recipientId,
			senderId: payload.senderId,
			type: payload.type,
			title: payload.title,
			content: payload.content,
			link: payload.link,
		});

		try {
			const io = getIO();
			io.to(`user:${payload.recipientId}`).emit(
				"notification:new",
				createdNotification,
			);
			logger.info(
				{ recipientId: payload.recipientId, traceId: payload.traceId },
				`Real-time notification dispatched directly to user:${payload.recipientId}`,
			);
		} catch (socketError) {
			// A missing socket server must not fail the job: the row is already
			// stored and the client will see it on its next poll.
			logger.warn(
				{ err: socketError, traceId: payload.traceId },
				"Socket system offline; falling back to DB storage",
			);
		}
	},
	{
		connection: createQueueConnection(),
		concurrency: 10,
	},
);
