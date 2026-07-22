import { Worker } from "bullmq";
import { createQueueConnection } from "../queues/connection.js";
import { postRepository } from "../repositories/index.js";
import { logger } from "../utils/logger.js";
import {
	calculateControversialScore,
	calculateHotScore,
} from "../utils/ranking.math.js";
import { redis } from "../utils/redis.js";

export const rankingWorker = new Worker(
	"ranking-cron-queue",
	async () => {
		logger.info(" Compiling dynamic feed rankings...");

		// Pull top 1,000 active recent items to recalculate rankings
		const recentPosts = await postRepository.findRecentActivePosts(1000);

		const globalHotKey = "feed:global:hot";
		const globalControversialKey = "feed:global:controversial";

		// Extract the raw client to execute the atomic pipeline operation smoothly
		const rawRedisClient = redis.getClient();
		const pipeline = rawRedisClient.pipeline();

		for (const post of recentPosts) {
			const { upvotes, downvotes } = await postRepository.getVoteMetrics(
				post.id,
			);

			const hotScore = calculateHotScore(upvotes, downvotes, post.createdAt);
			const controversialScore = calculateControversialScore(
				upvotes,
				downvotes,
			);

			// Populate memory Sets inside Redis
			pipeline.zadd(globalHotKey, hotScore, post.id);
			pipeline.zadd(globalControversialKey, controversialScore, post.id);
		}

		// Cap indexes at 1,000 items to drop old tail-end memory weights
		pipeline.zremrangebyrank(globalHotKey, 0, -1001);
		pipeline.zremrangebyrank(globalControversialKey, 0, -1001);

		await pipeline.exec();
		logger.info("Dynamic feed rankings updated in Redis.");
	},
	{ connection: createQueueConnection() },
);
