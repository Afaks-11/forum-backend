import type { PrismaClient } from "../generated/prisma/client.js";
import { Prisma } from "../generated/prisma/client.js";
import type {
	CreatePostInput,
	UpdatePostInput,
} from "../validators/post.validator.js";

/**
 * Shared shape for every list/detail read so the feed, search, and
 * recommendation paths cannot drift apart. Vote tallies come from the
 * denormalized scalar columns on `posts`, so only comments need aggregating.
 */
export const postListInclude = {
	author: { select: { username: true } },
	community: { select: { name: true, slug: true } },
	_count: { select: { comments: true } },
} satisfies Prisma.PostInclude;

export type PostListRow = Prisma.PostGetPayload<{
	include: typeof postListInclude;
}>;

export class PostRepository {
	constructor(private readonly prisma: PrismaClient) {}

	async create(data: CreatePostInput, authorId: string) {
		return await this.prisma.post.create({
			data: {
				title: data.title,
				content: data.content,
				authorId: authorId,
				communityId: data.communityId,
				type: data.type,
			},
		});
	}

	/**
	 * Fetches an active post with author, community, and comment count.
	 * Soft-deleted rows are filtered out, which is why this is `findFirst`
	 * rather than `findUnique` despite the ID being unique.
	 */
	async findById(id: string) {
		return await this.prisma.post.findFirst({
			where: { id, deletedAt: null },
			include: postListInclude,
		});
	}

	/**
	 * Fetches a post regardless of soft-delete state, for ownership and
	 * moderation checks that must still see deleted rows.
	 */
	async findUniqueById(id: string) {
		return await this.prisma.post.findUnique({
			where: { id },
		});
	}

	/**
	 * Fetches a post together with the viewer's own vote in a single round trip.
	 * The nested `votes` filter narrows to at most one row via the
	 * `(userId, postId)` unique, so this replaces a separate vote lookup.
	 */
	async findByIdWithViewerVote(id: string, viewerId?: string) {
		return await this.prisma.post.findFirst({
			where: { id, deletedAt: null },
			include: {
				...postListInclude,
				votes: viewerId
					? { where: { userId: viewerId }, select: { type: true } }
					: false,
			},
		});
	}

	/**
	 * Bulk-fetches active posts by ID for the ranked feed paths.
	 * Result order is not guaranteed to match `ids`; callers that need the
	 * ranking preserved must reorder.
	 */
	async findManyByIds(ids: string[]) {
		// Prisma would emit `IN ()` for an empty list, so short-circuit instead.
		if (ids.length === 0) return [];

		return await this.prisma.post.findMany({
			where: {
				id: { in: ids },
				deletedAt: null,
			},
			include: postListInclude,
		});
	}

	/**
	 * Feeds the ranking worker the newest active posts to rescore. Only the
	 * columns the scoring functions read are selected.
	 */
	async findRecentActivePosts(limit: number) {
		return await this.prisma.post.findMany({
			where: { deletedAt: null },
			take: limit,
			orderBy: { createdAt: "desc" },
			select: {
				id: true,
				createdAt: true,
				upvoteCount: true,
				downvoteCount: true,
			},
		});
	}

	/**
	 * Resolves the viewer's vote for a page of posts in one query.
	 * Returns a lookup keyed by post ID so callers can attach `currentUserVote`
	 * without a per-row query.
	 */
	async findViewerVotes(postIds: string[], viewerId: string) {
		if (postIds.length === 0) return new Map<string, "UPVOTE" | "DOWNVOTE">();

		const votes = await this.prisma.vote.findMany({
			where: { userId: viewerId, postId: { in: postIds } },
			select: { postId: true, type: true },
		});

		return new Map(votes.map((vote) => [vote.postId, vote.type]));
	}

	async update(id: string, data: UpdatePostInput) {
		return await this.prisma.post.update({
			where: { id },
			data: {
				...(data.title !== undefined ? { title: data.title } : {}),
				...(data.content !== undefined ? { content: data.content } : {}),
			},
		});
	}

	async softDelete(id: string) {
		return await this.prisma.post.update({
			where: { id },
			data: { deletedAt: new Date() },
		});
	}

	/**
	 * Adds a post to a user's saved list idempotently.
	 */
	async save(postId: string, userId: string) {
		return await this.prisma.savedPost.upsert({
			where: { userId_postId: { userId, postId } },
			update: {},
			create: { userId, postId },
		});
	}

	async unsave(postId: string, userId: string) {
		return await this.prisma.savedPost.deleteMany({
			where: { userId, postId },
		});
	}

	async updateLockStatus(
		id: string,
		isLocked: boolean,
		lockSetById: string | null,
	) {
		return await this.prisma.post.update({
			where: { id },
			data: { isLocked, lockSetById },
		});
	}

	async updatePinStatus(id: string, isPinned: boolean) {
		return await this.prisma.post.update({
			where: { id },
			data: { isPinned },
		});
	}

	/**
	 * Cursor-paginated feed with optional community/author filters and sorting.
	 */
	async getAdvancedFeed(filters: {
		sort?: "new" | "top" | "hot" | "controversial";
		community?: string;
		author?: string;
		cursor?: string;
		limit?: number;
	}) {
		const take = filters.limit || 10;

		const whereClause: Prisma.PostWhereInput = {
			deletedAt: null,
			...(filters.community
				? { community: { slug: filters.community.toLowerCase() } }
				: {}),
			...(filters.author ? { author: { username: filters.author } } : {}),
		};

		// Every sort resolves against a stored, indexed column. This path is the
		// fallback used when the Redis ZSETs are unavailable, and it now ranks
		// identically to them rather than approximating with raw vote volume.
		let orderByClause:
			| Prisma.PostOrderByWithRelationInput
			| Prisma.PostOrderByWithRelationInput[] = [
			{ createdAt: "desc" },
			{ id: "desc" },
		];

		if (filters.sort === "top") {
			orderByClause = [
				{ score: "desc" },
				{ createdAt: "desc" },
				{ id: "desc" },
			];
		} else if (filters.sort === "hot") {
			orderByClause = [
				{ hotScore: "desc" },
				{ createdAt: "desc" },
				{ id: "desc" },
			];
		} else if (filters.sort === "controversial") {
			orderByClause = [
				{ controversialScore: "desc" },
				{ createdAt: "desc" },
				{ id: "desc" },
			];
		}

		const posts = await this.prisma.post.findMany({
			where: whereClause,
			// One extra row is fetched purely to detect whether another page
			// exists; it is popped below and never returned.
			take: take + 1,
			include: postListInclude,
			orderBy: orderByClause,
			...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
		});

		const hasNextPage = posts.length > take;
		if (hasNextPage) posts.pop();

		const lastPost = posts[posts.length - 1];
		const nextCursor = hasNextPage && lastPost ? lastPost.id : null;

		return { posts, nextCursor };
	}

	/** PostgreSQL full-text search ordered by relevance with a stable ID tie-breaker. */
	async searchPosts(filters: {
		query: string;
		limit: number;
		cursor?: string | null;
	}) {
		const take = filters.limit || 10;
		const cursorCondition = filters.cursor
			? Prisma.sql`WHERE (ranked.rank, ranked.id) < (
				SELECT cursor_rank.rank, cursor_rank.id
				FROM ranked cursor_rank
				WHERE cursor_rank.id = ${filters.cursor}
			)`
			: Prisma.empty;
		const rows = await this.prisma.$queryRaw<
			{ id: string; rank: number; createdAt: Date }[]
		>(Prisma.sql`
			WITH ranked AS (
				SELECT p.id, p.created_at AS "createdAt",
					ts_rank(
						COALESCE(
							p.search_vector,
							setweight(to_tsvector('english', coalesce(p.title, '')), 'A') ||
							setweight(to_tsvector('english', coalesce(p.content, '')), 'B')
						),
						websearch_to_tsquery('english', ${filters.query})
					) AS rank
				FROM posts p
				WHERE p.deleted_at IS NULL
					AND COALESCE(
						p.search_vector,
						setweight(to_tsvector('english', coalesce(p.title, '')), 'A') ||
						setweight(to_tsvector('english', coalesce(p.content, '')), 'B')
					) @@ websearch_to_tsquery('english', ${filters.query})
			)
			SELECT ranked.id, ranked."createdAt", ranked.rank
			FROM ranked
			${cursorCondition}
			ORDER BY ranked.rank DESC, ranked.id DESC
			LIMIT ${take + 1}
		`);

		const hasNextPage = rows.length > take;
		if (hasNextPage) rows.pop();

		const ids = rows.map((row) => row.id);
		const hydrated = await this.findManyByIds(ids);
		const byId = new Map(hydrated.map((post) => [post.id, post]));
		const posts = ids
			.map((id) => byId.get(id))
			.filter((post): post is NonNullable<typeof post> => post !== undefined);

		const lastPost = posts[posts.length - 1];
		const nextCursor = hasNextPage && lastPost ? lastPost.id : null;

		return { posts, nextCursor };
	}

	/**
	 * Writes a batch of freshly computed ranking scores in one statement.
	 *
	 * The ranking worker rescores up to a thousand posts per pass; issuing one
	 * UPDATE each would dominate the job's runtime, so the batch is folded into
	 * a single `UPDATE ... FROM (VALUES ...)`.
	 */
	async updateRankingScores(
		scores: { id: string; hotScore: number; controversialScore: number }[],
	) {
		if (scores.length === 0) return 0;

		const values = Prisma.join(
			scores.map(
				(row) =>
					Prisma.sql`(${row.id}::text, ${row.hotScore}::double precision, ${row.controversialScore}::double precision)`,
			),
		);

		return await this.prisma.$executeRaw`
			UPDATE posts AS p
			SET hot_score = v.hot_score,
			    controversial_score = v.controversial_score
			FROM (VALUES ${values}) AS v(id, hot_score, controversial_score)
			WHERE p.id = v.id
		`;
	}
}
