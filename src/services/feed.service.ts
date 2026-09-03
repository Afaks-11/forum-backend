import type { VoteType } from "../generated/prisma/client.js";
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
 * Resolves the caller's own vote for a page of posts in one query and folds it
 * into each row.
 *
 * Pages are cached without viewer context so every reader shares one entry; the
 * per-viewer field is layered on afterwards, on both the hit and miss paths.
 * Doing it here rather than in the repository keeps the cached payload
 * viewer-agnostic.
 */
const attachViewerVotes = async <T extends { id: string }>(
	posts: T[],
	viewerId?: string,
): Promise<(T & { currentUserVote: VoteType | null })[]> => {
	if (!viewerId || posts.length === 0) {
		return posts.map((post) => ({ ...post, currentUserVote: null }));
	}

	const votes = await postRepository.findViewerVotes(
		posts.map((post) => post.id),
		viewerId,
	);

	return posts.map((post) => ({
		...post,
		currentUserVote: votes.get(post.id) ?? null,
	}));
};

/**
 * The single feed implementation, serving both `GET /feed` and `GET /posts`.
 */
export const getAdvancedPostsFeed = async (
	filters: AdvancedFeedFilters,
	viewerId?: string,
) => {
	const targetSort = filters.sort ?? "new";
	const targetLimit = filters.limit ?? 10;

	if (
		(targetSort === "hot" || targetSort === "controversial") &&
		!filters.community &&
		!filters.author
	) {
		const rawRedisClient = redis.getClient();
		const zsetKey = `feed:global:${targetSort}`;
		// The schema guarantees a numeric-or-UUID cursor; a UUID reaching this
		// ranked path means the client carried a keyset cursor across a sort
		// change, so the page restarts at rank 0 instead of producing NaN offsets.
		const parsedOffset = filters.cursor ? Number(filters.cursor) : 0;
		const startOffset =
			Number.isInteger(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;
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
				posts: await attachViewerVotes(orderedPosts, viewerId),
				nextCursor,
			};
		}
	}

	// Standard keyset paths (new / top / any contextual filter).
	// Rebuilt key by key instead of spread
	const repoFilters: {
		sort?: "new" | "top" | "hot" | "controversial";
		community?: string;
		author?: string;
		cursor?: string;
		limit?: number;
	} = { sort: targetSort, limit: targetLimit };

	if (filters.community) repoFilters.community = filters.community;
	if (filters.author) repoFilters.author = filters.author;
	if (filters.cursor) repoFilters.cursor = filters.cursor;

	// The filter set is hashed into the key so each sort/community/cursor
	// combination caches independently instead of overwriting one another.
	const filterHash = Buffer.from(JSON.stringify(repoFilters)).toString(
		"base64",
	);
	const cacheKey = `feed:advanced:${filterHash}`;

	let feed = await redis.get<AdvancedFeedPayload>(cacheKey);
	if (!feed) {
		feed = await postRepository.getAdvancedFeed(repoFilters);
		await redis.set(cacheKey, feed, 300);
	}

	return {
		...feed,
		posts: await attachViewerVotes(feed.posts, viewerId),
	};
};
