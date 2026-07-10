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
