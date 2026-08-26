import { Queue } from "bullmq";
import { createQueueConnection } from "./connection.js";

export interface CronJobData {
	action:
		| "PURGE_OLD_NOTIFICATIONS"
		| "HARD_PURGE_DELETED_POSTS"
		| "HARD_PURGE_DELETED_COMMUNITIES"
		| "RANK_FEED";
}

export const cronQueue = new Queue<CronJobData>("cron-queue", {
	connection: createQueueConnection(),
});

/**
 * Registers the application's repeatable maintenance jobs.
 * Each job carries a fixed `jobId` so re-running this on every boot updates the
 * existing schedule instead of stacking duplicate repeaters in Redis.
 */
export const initScheduledJobs = async (): Promise<void> => {
	// Daily at midnight.
	await cronQueue.add(
		"purge-notifications",
		{ action: "PURGE_OLD_NOTIFICATIONS" },
		{
			repeat: {
				pattern: "0 0 * * *",
			},
			jobId: "daily-notification-purge",
		},
	);

	// Weekly on Sunday at 2 AM.
	await cronQueue.add(
		"hard-purge-posts",
		{ action: "HARD_PURGE_DELETED_POSTS" },
		{
			repeat: {
				pattern: "0 2 * * 0",
			},
			jobId: "weekly-soft-delete-purge",
		},
	);

	await cronQueue.add(
		"hard-purge-communities",
		{ action: "HARD_PURGE_DELETED_COMMUNITIES" },
		{
			repeat: {
				pattern: "30 2 * * 0",
			},
			jobId: "weekly-community-soft-delete-purge",
		},
	);

	// Every 5 minutes.
	await cronQueue.add(
		"rank-feed",
		{
			action: "RANK_FEED",
		},
		{
			repeat: {
				pattern: "*/5 * * * *",
			},
			jobId: "feed-ranking",
		},
	);
};
