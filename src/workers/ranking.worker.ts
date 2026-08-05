import { Worker } from "bullmq";
import { createQueueConnection } from "../queues/connection.js";
import { postRepository } from "../repositories/index.js";
import { logger } from "../utils/logger.js";
import {
	calculateControversialScore,
	calculateHotScore,
} from "../utils/ranking.math.js";
import { redis } from "../utils/redis.js";

/**
 * Recomputes the global hot and controversial feed ZSETs on a schedule.
 * Scores are precomputed here rather than at read time because hot ranking
 * depends on vote totals that would otherwise require a sort over every post
 * on every feed request.
 */
export const rankingWorker = new Worker(
	"ranking-cron-queue",
	async () => {
		logger.info(" Compiling dynamic feed rankings...");

		// Bounded to the most recent 1,000 active posts: older content cannot
		// realistically re-enter the hot feed, and an unbounded scan would grow
		// the job's runtime with the table.
		const recentPosts = await postRepository.findRecentActivePosts(1000);

		const globalHotKey = "feed:global:hot";
		const globalControversialKey = "feed:global:controversial";

		// All ZADDs are batched into one pipeline so readers never observe a
		// half-rebuilt index across many separate round trips.
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

			pipeline.zadd(globalHotKey, hotScore, post.id);
			pipeline.zadd(globalControversialKey, controversialScore, post.id);
		}

		// Trim to the top 1,000 by rank; without this the ZSETs would accumulate
		// every post ever ranked and grow without bound.
		pipeline.zremrangebyrank(globalHotKey, 0, -1001);
		pipeline.zremrangebyrank(globalControversialKey, 0, -1001);

		await pipeline.exec();
		logger.info("Dynamic feed rankings updated in Redis.");
	},
	{ connection: createQueueConnection() },
);
