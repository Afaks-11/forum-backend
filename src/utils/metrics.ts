import client, { Histogram } from "prom-client";
import { cronQueue } from "../queues/cron.queue.js";
import { emailQueue } from "../queues/email.queue.js";
import { notificationQueue } from "../queues/notification.queue.js";

// Default collectors (CPU, memory, event-loop lag) are namespaced so forum
// series never collide with metrics from sidecars sharing the same Prometheus.
client.collectDefaultMetrics({
	prefix: "forum_",
});

export const httpRequestCounter = new client.Counter({
	name: "forum_http_requests_total",
	help: "Total number of HTTP requests processed by the backend engine",
	labelNames: ["method", "route", "status_code"],
});

export const httpRequestDurationHistogram = new Histogram({
	name: "forum_http_request_duration_seconds",
	help: "Duration of HTTP requests in fractional seconds",
	labelNames: ["method", "route", "status_code"],
	// Buckets are weighted toward the low millisecond range because most
	// endpoints are cache- or index-backed; the default buckets would put
	// almost every request in the first slot and hide real regressions.
	buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

export const bullmqQueueJobsGauge = new client.Gauge({
	name: "forum_bullmq_queue_jobs_total",
	help: "Total count of jobs inside BullMQ infrastructure categorized by queue and execution state",
	labelNames: ["queue", "state"],
});

/**
 * Refreshes the BullMQ backlog gauge from Redis.
 * Called on each scrape rather than on job events so the numbers stay accurate
 * even for jobs enqueued by other processes.
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
			// Per-queue failures are contained so one unreachable queue leaves the
			// remaining metrics scrapable instead of failing the whole endpoint.
		}
	}
};

export const register = client.register;
