import { postRepository } from "../repositories/index.js";
import { redis } from "../utils/redis.js";

interface AdvancedFeedFilters {
	sort?: "new" | "top" | "hot" | "controversial";
	community?: string | undefined;
	author?: string | undefined;
	cursor?: string | undefined;
	limit?: number | undefined;
}

type AdvancedFeedPayload = Awaited<
	ReturnType<typeof postRepository.getAdvancedFeed>
>;

/**
 * Returns a cursor-paginated feed sorted by new, top, hot, or controversial.
 *
 * Hot and controversial without filters hit Redis sorted sets (ZSETs) built by
 * the ranking worker; all other paths cache the repository result. The ZSET
 * path uses offset pagination because Redis ZREVRANGE returns by rank, not by
 * cursor.
 */
export const getAdvancedPostsFeed = async (filters: AdvancedFeedFilters) => {
	const targetSort = filters.sort ?? "new";
	const targetLimit = filters.limit ?? 10;

	if (
		(targetSort === "hot" || targetSort === "controversial") &&
		!filters.community &&
		!filters.author
	) {
		const rawRedisClient = redis.getClient();
		const zsetKey = `feed:global:${targetSort}`;
		const startOffset = filters.cursor ? parseInt(filters.cursor, 10) : 0;
		const stopOffset = startOffset + targetLimit - 1;

		const rankedIds: string[] = await rawRedisClient.zrevrange(
			zsetKey,
			startOffset,
			stopOffset,
		);

		if (rankedIds.length > 0) {
			const postsData = await postRepository.findManyByIds(rankedIds);

			// Restore the original ZSET ordering: Redis returns IDs by rank but does
			// not guarantee the order of the bulk-fetch result, so the list is rebuilt
			// by matching each ranked ID to its post record.
			const orderedPosts = rankedIds
				.map((id: string) => postsData.find((post) => post.id === id))
				.filter((post): post is NonNullable<typeof post> => !!post);

			// Peek one rank past the page to decide whether a next cursor exists,
			// avoiding a cursor that leads to an empty page.
			const checkNextIds: string[] = await rawRedisClient.zrevrange(
				zsetKey,
				stopOffset + 1,
				stopOffset + 1,
			);
			const nextCursor =
				checkNextIds.length > 0 ? (startOffset + targetLimit).toString() : null;

			return {
				posts: orderedPosts,
				nextCursor,
			};
		}
	}

	// Standard Chronological Cache Paths (New / Top / Context Filters)
	const filterHash = Buffer.from(JSON.stringify(filters)).toString("base64");
	const cacheKey = `feed:advanced:${filterHash}`;

	const cachedFeed = await redis.get<AdvancedFeedPayload>(cacheKey);
	if (cachedFeed) return cachedFeed;

	// Rebuilt key by key instead of spread: the incoming type permits explicit
	// `undefined`, which `exactOptionalPropertyTypes` will not accept downstream.
	const repoFilters: {
		sort?: "new" | "top" | "hot" | "controversial";
		community?: string;
		author?: string;
		cursor?: string;
		limit?: number;
	} = {};

	if (filters.sort) repoFilters.sort = filters.sort;
	if (filters.community) repoFilters.community = filters.community;
	if (filters.author) repoFilters.author = filters.author;
	if (filters.cursor) repoFilters.cursor = filters.cursor;
	if (filters.limit) repoFilters.limit = filters.limit;

	const feed = await postRepository.getAdvancedFeed(repoFilters);

	await redis.set(cacheKey, feed, 300);

	return feed;
};
