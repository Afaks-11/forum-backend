import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import type {
	CreatePostInput,
	updatePostInput,
} from "../validators/post.validator.js";

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
	 * Fetches an active post with author, community, and engagement counts.
	 * Soft-deleted rows are filtered out, which is why this is `findFirst`
	 * rather than `findUnique` despite the ID being unique.
	 */
	async findById(id: string) {
		return await this.prisma.post.findFirst({
			where: { id, deletedAt: null },
			include: {
				user: { select: { username: true } },
				community: { select: { name: true, slug: true } },
				_count: { select: { comment: true, votes: true } },
			},
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
			include: {
				user: { select: { username: true } },
				community: { select: { name: true, slug: true } },
				_count: { select: { comment: true, votes: true } },
			},
		});
	}

	/**
	 * Feeds the ranking worker the newest active posts to rescore.
	 */
	async findRecentActivePosts(limit: number) {
		return await this.prisma.post.findMany({
			where: { deletedAt: null },
			take: limit,
			orderBy: { createdAt: "desc" },
		});
	}

	async update(id: string, data: updatePostInput) {
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

	async updateLockStatus(id: string, isLocked: boolean) {
		return await this.prisma.post.update({
			where: { id },
			data: { isLocked },
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
			...(filters.author ? { user: { username: filters.author } } : {}),
		};

		//  Explicitly typed orderByClause supporting single objects or evaluation arrays
		let orderByClause:
			| Prisma.PostOrderByWithRelationInput
			| Prisma.PostOrderByWithRelationInput[] = {
			createdAt: "desc",
		};

		// Hot and controversial fall back to a vote-count ordering here; their
		// real scoring lives in the Redis ZSETs maintained by the ranking worker
		// and is only reached when those sets are unavailable or filtered out.
		if (filters.sort === "top") {
			orderByClause = { votes: { _count: "desc" } };
		} else if (filters.sort === "hot" || filters.sort === "controversial") {
			orderByClause = [{ votes: { _count: "desc" } }, { createdAt: "desc" }];
		}

		const posts = await this.prisma.post.findMany({
			where: whereClause,
			// One extra row is fetched purely to detect whether another page
			// exists; it is popped below and never returned.
			take: take + 1,
			skip: filters.cursor ? 1 : 0,
			include: {
				user: { select: { username: true } },
				community: { select: { name: true, slug: true } },
				_count: { select: { comment: true, votes: true } },
			},
			orderBy: orderByClause,
			...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
		});

		const hasNextPage = posts.length > take;
		if (hasNextPage) posts.pop();

		const lastPost = posts[posts.length - 1];
		const nextCursor = hasNextPage && lastPost ? lastPost.id : null;

		return { posts, nextCursor };
	}

	/**
	 * Counts upvotes and downvotes in parallel, as neither depends on the other.
	 */
	async getVoteMetrics(postId: string) {
		const [upvotes, downvotes] = await Promise.all([
			this.prisma.vote.count({ where: { postId, type: "UPVOTE" } }),
			this.prisma.vote.count({ where: { postId, type: "DOWNVOTE" } }),
		]);
		return { upvotes, downvotes };
	}

	async getUserVote(postId: string, userId: string) {
		return await this.prisma.vote.findUnique({
			where: { userId_postId: { userId, postId } },
		});
	}

	/**
	 * Case-insensitive keyword search over active post titles and bodies,
	 * cursor-paginated in the same shape as the feed.
	 */
	async searchPosts(filters: {
		query: string;
		limit: number;
		cursor?: string | null;
	}) {
		const take = filters.limit || 10;

		const whereClause: Prisma.PostWhereInput = {
			deletedAt: null,
			OR: [
				{ title: { contains: filters.query, mode: "insensitive" } },
				{ content: { contains: filters.query, mode: "insensitive" } },
			],
		};

		const posts = await this.prisma.post.findMany({
			where: whereClause,
			take: take + 1,
			include: {
				user: { select: { username: true } },
				community: { select: { name: true, slug: true } },
				_count: { select: { comment: true, votes: true } },
			},
			orderBy: { createdAt: "desc" },
			...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
		});

		const hasNextPage = posts.length > take;
		if (hasNextPage) posts.pop();

		const lastPost = posts[posts.length - 1];
		const nextCursor = hasNextPage && lastPost ? lastPost.id : null;

		return { posts, nextCursor };
	}
}
