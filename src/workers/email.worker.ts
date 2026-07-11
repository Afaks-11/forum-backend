import { type Job, Worker } from "bullmq";
import { createQueueConnection } from "../queues/connection.js";
import type { EmailJobData } from "../queues/email.queue.js";
import { sendSystemEmail } from "../utils/mailer.js";

export const emailWorker = new Worker<EmailJobData>(
	"email-queue",
	async (job: Job<EmailJobData>) => {
		const { to, subject, htmlContent } = job.data;

		console.log(`[Email Worker] Processing job ${job.id} targeting ${to}`);
		await sendSystemEmail(to, subject, htmlContent);
	},
	{
		connection: createQueueConnection(),
		concurrency: 5, // Process up to 5 emails in parallel
	},
);

emailWorker.on("failed", (job, err) => {
	console.error(
		`[Email Worker] Job ${job?.id} permanently failed: ${err.message}`,
	);
});
