import { type Job, Worker } from "bullmq";
import { createQueueConnection } from "../queues/connection.js";
import type { CronJobData } from "../queues/cron.queue.js";
import { logger } from "../utils/logger.js";
import { prisma } from "../utils/prisma.js";

export const cronWorker = new Worker<CronJobData>(
	"cron-queue",
	async (job: Job<CronJobData>) => {
		const { action } = job.data;

		logger.info(
			{ jobId: job.id, targetAction: action },
			`[Cron Worker] Executing task: ${action}`,
		);

		switch (action) {
			case "PURGE_OLD_NOTIFICATIONS": {
				const thirtyDaysAgo = new Date();
				thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

				const result = await prisma.notification.deleteMany({
					where: {
						read: true,
						createdAt: { lt: thirtyDaysAgo },
					},
				});

				logger.info(
					{ purgedCount: result.count },
					`[Cron Worker] Purged stale read notifications.`,
				);
				break;
			}
			case "HARD_PURGE_DELETED_POSTS": {
				const thirtyDaysAgo = new Date();
				thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

				const result = await prisma.post.deleteMany({
					where: {
						deletedAt: {
							not: null,
							lt: thirtyDaysAgo,
						},
					},
				});

				logger.info(
					{ purgedCount: result.count },
					`[Cron Worker] Hard-purged soft-deleted posts older than 30 days.`,
				);
				break;
			}
		}
	},
	{
		connection: createQueueConnection(),
	},
);
