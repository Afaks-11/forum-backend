import client, { Histogram } from "prom-client";
import { cronQueue } from "../queues/cron.queue.js";
import { emailQueue } from "../queues/email.queue.js";
import { notificationQueue } from "../queues/notification.queue.js";

// Instantiate the global metrics runtime collection (Captures CPU, Memory, Event Loop Lag)
client.collectDefaultMetrics({
	prefix: "forum_",
});

// Define custom counter for HTTP transaction volume tracking
export const httpRequestCounter = new client.Counter({
	name: "forum_http_requests_total",
	help: "Total number of HTTP requests processed by the backend engine",
	labelNames: ["method", "route", "status_code"],
});

// Define custom histogram to observe response latencies
export const httpRequestDurationHistogram = new Histogram({
	name: "forum_http_request_duration_seconds",
	help: "Duration of HTTP requests in fractional seconds",
	labelNames: ["method", "route", "status_code"],
	buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10], // Granular bucket slots for fast APIs
});

// Define custom gauge to track real-time queue backlogs across the BullMQ layout
export const bullmqQueueJobsGauge = new client.Gauge({
	name: "forum_bullmq_queue_jobs_total",
	help: "Total count of jobs inside BullMQ infrastructure categorized by queue and execution state",
	labelNames: ["queue", "state"],
});

/**
 * Iterates through active BullMQ queues to collect current job states dynamically during scraping.
 */
export const syncBullMQMetrics = async (): Promise<void> => {
	const queueMap = [
		{ name: "cron-queue", instance: cronQueue },
		{ name: "email-queue", instance: emailQueue },
		{ name: "notification-queue", instance: notificationQueue },
	];

	for (const queue of queueMap) {
		try {
			const counts = await queue.instance.getJobCounts(
				"active",
				"waiting",
				"completed",
				"failed",
				"delayed",
			);

			bullmqQueueJobsGauge.set(
				{ queue: queue.name, state: "active" },
				counts.active ?? 0,
			);
			bullmqQueueJobsGauge.set(
				{ queue: queue.name, state: "waiting" },
				counts.waiting ?? 0,
			);
			bullmqQueueJobsGauge.set(
				{ queue: queue.name, state: "completed" },
				counts.completed ?? 0,
			);
			bullmqQueueJobsGauge.set(
				{ queue: queue.name, state: "failed" },
				counts.failed ?? 0,
			);
			bullmqQueueJobsGauge.set(
				{ queue: queue.name, state: "delayed" },
				counts.delayed ?? 0,
			);
		} catch {
			// Suppress errors to ensure a transient Redis timeout doesn't break the entire scraping pipeline
		}
	}
};

export const register = client.register;
