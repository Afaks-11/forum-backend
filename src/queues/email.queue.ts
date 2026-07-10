import { Queue } from "bullmq";
import { createQueueConnection } from "./connection.js";

export interface EmailJobData {
	to: string;
	subject: string;
	htmlContent: string;
}

export const emailQueue = new Queue<EmailJobData>("email-queue", {
	connection: createQueueConnection(),
	defaultJobOptions: {
		attempts: 3,
		backoff: {
			type: "exponential",
			delay: 5000,
		},
		removeOnComplete: 100,
		removeOnFail: 500,
	},
});
