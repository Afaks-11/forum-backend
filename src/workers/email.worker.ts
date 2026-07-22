import { type Job, Worker } from "bullmq";
import { createQueueConnection } from "../queues/connection.js";
import type { EmailJobData } from "../queues/email.queue.js";
import { logger } from "../utils/logger.js";
import { sendSystemEmail } from "../utils/mailer.js";

export const emailWorker = new Worker<EmailJobData>(
	"email-queue",
	async (job: Job<EmailJobData>) => {
		const { to, subject, htmlContent } = job.data;

		logger.info(
			{ jobId: job.id, recipient: to },
			`[Email Worker] Processing outgoing email transaction}`,
		);
		await sendSystemEmail(to, subject, htmlContent);
	},
	{
		connection: createQueueConnection(),
		concurrency: 5, // Process up to 5 emails in parallel
	},
);

emailWorker.on("failed", (job, err) => {
	logger.error(
		{ jobId: job?.id, err },
		`[Email Worker] Job permanently failed: ${err.message}`,
	);
});
