import { Queue } from "bullmq";
import { logger } from "../utils/logger.js";
import { getTraceId } from "../utils/requestContext.js";
import { createQueueConnection } from "./connection.js";

export interface EmailJobData {
	to: string;
	subject: string;
	htmlContent: string;
	/**
	 * Trace ID of the request that queued this job, when there was one. Lets a
	 * delivery failure in the worker be joined back to the originating request.
	 */
	traceId?: string;
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

/**
 * Enqueues a transactional email without letting a queue outage fail the caller.
 *
 * Every producer runs after its database write has committed — a registration
 * row, a rotated reset token — so a rejected enqueue must not turn a succeeded
 * operation into a 500 that the client will retry against already-persisted
 * state. The rejection is logged instead, and the affected user can re-request
 * the mail through the resend endpoints.
 *
 * The recipient address is deliberately absent from the log line: it is PII and
 * the job name already carries the user id needed to correlate.
 */
export const enqueueSystemEmail = async (
	name: string,
	data: EmailJobData,
): Promise<void> => {
	const traceId = getTraceId();

	try {
		await emailQueue.add(name, {
			...data,
			...(traceId ? { traceId } : {}),
		});
	} catch (error) {
		logger.error(
			{ err: error, jobName: name, traceId },
			"Failed to enqueue system email; the originating write is unaffected.",
		);
	}
};
