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
 *
 * Scores are precomputed here rather than at read time because ranking depends
 * on vote totals that would otherwise require a sort over every post on every
 * feed request. Tallies are read from the posts table's denormalized counters,
 * so the whole pass costs one SELECT and one batched UPDATE regardless of how
 * many posts are rescored.
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

		const scores = recentPosts.map((post) => {
			const hotScore = calculateHotScore(
				post.upvoteCount,
				post.downvoteCount,
				post.createdAt,
			);
			const controversialScore = calculateControversialScore(
				post.upvoteCount,
				post.downvoteCount,
			);

			pipeline.zadd(globalHotKey, hotScore, post.id);
			pipeline.zadd(globalControversialKey, controversialScore, post.id);

			return { id: post.id, hotScore, controversialScore };
		});

		// Trim to the top 1,000 by rank; without this the ZSETs would accumulate
		// every post ever ranked and grow without bound.
		pipeline.zremrangebyrank(globalHotKey, 0, -1001);
		pipeline.zremrangebyrank(globalControversialKey, 0, -1001);

		// Persisted alongside Redis so the SQL feed fallback orders by the same
		// scores the ZSETs hold instead of degrading to raw vote volume.
		await Promise.all([
			pipeline.exec(),
			postRepository.updateRankingScores(scores),
		]);

		logger.info("Dynamic feed rankings updated in Redis and Postgres.");
	},
	{ connection: createQueueConnection() },
);
