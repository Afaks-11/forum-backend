import { type Job, Worker } from "bullmq";
import { createQueueConnection } from "../queues/connection.js";
import type { EmailJobData } from "../queues/email.queue.js";
import { logger } from "../utils/logger.js";
import { maskEmail, sendSystemEmail } from "../utils/mailer.js";

/**
 * Drains the email queue by handing each job to the SMTP transport.
 *
 * A rejected send is left to propagate so BullMQ applies the configured
 * exponential retries and, on final failure, keeps the job in the failed set.
 */
export const emailWorker = new Worker<EmailJobData>(
	"email-queue",
	async (job: Job<EmailJobData>) => {
		const { to, subject, htmlContent, traceId } = job.data;

		// Recipient addresses are PII; only the masked form is logged.
		logger.info(
			{ jobId: job.id, recipient: maskEmail(to), traceId },
			"[Email Worker] Processing outgoing email transaction",
		);
		await sendSystemEmail(to, subject, htmlContent);
	},
	{
		connection: createQueueConnection(),
		// Kept low deliberately: SMTP providers throttle aggressively and a
		// higher fan-out mostly converts into retried jobs.
		concurrency: 5,
	},
);

emailWorker.on("failed", (job, err) => {
	logger.error(
		{ jobId: job?.id, traceId: job?.data?.traceId, err },
		`[Email Worker] Job permanently failed: ${err.message}`,
	);
});
