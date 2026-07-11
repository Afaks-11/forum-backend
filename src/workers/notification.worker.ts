import { type Job, Worker } from "bullmq";
import { createQueueConnection } from "../queues/connection.js";
import type { NotificationJobData } from "../queues/notification.queue.js";
import { notificationRepository } from "../repositories/index.js";
import { getIO } from "../socket/socket.server.js";

export const notificationWorker = new Worker<NotificationJobData>(
	"notification-queue",
	async (job: Job<NotificationJobData>) => {
		const payload = job.data;

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
			console.log(
				`Real-time notification dispatched directly to user:${payload.recipientId}`,
			);
		} catch (_socketError) {
			console.warn("Socket system offline; falling back to DB storage");
		}
	},
	{
		connection: createQueueConnection(),
		concurrency: 10,
	},
);
