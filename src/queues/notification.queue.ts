import { Queue } from "bullmq";
import { createQueueConnection } from "./connection.js";

export interface NotificationJobData {
	recipientId: string;
	senderId?: string;
	type:
		| "NEW_FOLLOWER"
		| "REPLY"
		| "COMMENT"
		| "MOD_ACTION"
		| "COMMUNITY_INVITE";
	title: string;
	content: string;
	link?: string;
	/** Stable id of the committed event that produced this notification. */
	dedupeKey?: string;
	/**
	 * Trace ID of the request that queued this job, when there was one. Lets a
	 * worker-side failure be joined back to the originating request.
	 */
	traceId?: string;
}

export const notificationQueue = new Queue<NotificationJobData>(
	"notification-queue",
	{
		connection: createQueueConnection(),
		defaultJobOptions: {
			attempts: 2,
			backoff: {
				type: "fixed",
				delay: 2000,
			},
			removeOnComplete: 1000,
			removeOnFail: 1000,
		},
	},
);
