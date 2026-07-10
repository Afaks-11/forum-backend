import { Queue } from "bullmq";
import { createQueueConnection } from "./connection.js";

export interface CronJobData {
	action: "PURGE_OLD_NOTIFICATIONS" | "HARD_PURGE_DELETED_POSTS";
}

export const cronQueue = new Queue<CronJobData>("cron-queue", {
	connection: createQueueConnection(),
});

export const initScheduledJobs = async (): Promise<void> => {
	// Purge old read notifications: Runs daily at midnight
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

	// Purge soft-deleted posts older than 30 days: Runs weekly on Sunday at 2 AM
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
};
