import { type Job, Worker } from "bullmq";
import { createQueueConnection } from "../queues/connection.js";
import type { CronJobData } from "../queues/cron.queue.js";
import { rankingQueue } from "../queues/ranking.queue.js";
import { logger } from "../utils/logger.js";
import { prisma } from "../utils/prisma.js";

/**
 * Executes scheduled maintenance actions dispatched by the cron queue.
 * The purge branches delete through Prisma directly rather than a repository:
 * these are retention sweeps with no domain rules, not application reads or
 * writes.
 */
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
						isRead: true,
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

				// Soft-deleted rows are kept for 30 days so moderation decisions and
				// accidental deletions remain recoverable before the data is gone.
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

			case "HARD_PURGE_DELETED_COMMUNITIES": {
				const thirtyDaysAgo = new Date();
				thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

				const result = await prisma.community.deleteMany({
					where: {
						deletedAt: {
							not: null,
							lt: thirtyDaysAgo,
						},
					},
				});

				logger.info(
					{ purgedCount: result.count },
					`[Cron Worker] Hard-purged soft-deleted communities older than 30 days.`,
				);
				break;
			}

			case "RANK_FEED": {
				// The scheduler owns one repeatable-job registry, so RANK_FEED is
				// scheduled here and forwarded to the dedicated ranking queue rather
				// than executed inline. The ranking pass holds a Redis pipeline and a
				// batched UPDATE open; running it on the shared cron worker would let
				// it block the retention sweeps behind it.
				await rankingQueue.add("rank-feed", {});

				logger.info(
					"[Cron Worker] Dispatched a feed ranking pass to the ranking queue.",
				);
				break;
			}
		}
	},
	{
		connection: createQueueConnection(),
	},
);
