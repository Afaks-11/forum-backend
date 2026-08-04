import { Queue } from "bullmq";
import { createQueueConnection } from "./connection.js";

export const rankingQueue = new Queue("ranking-cron-queue", {
	connection: createQueueConnection(),
});
