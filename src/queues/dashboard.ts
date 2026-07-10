import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { cronQueue } from "./cron.queue.js";
import { emailQueue } from "./email.queue.js";
import { notificationQueue } from "./notification.queue.js";

const serverAdapter = new ExpressAdapter();

serverAdapter.setBasePath("/admin/queues");

createBullBoard({
	queues: [
		new BullMQAdapter(emailQueue),
		new BullMQAdapter(notificationQueue),
		new BullMQAdapter(cronQueue),
	],
	serverAdapter: serverAdapter,
	options: {
		uiConfig: {
			boardTitle: "Forum Core Queues",
		},
	},
});

export { serverAdapter as queueDashboardAdapter };
