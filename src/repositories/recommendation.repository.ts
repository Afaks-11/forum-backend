import type { PrismaClient } from "../generated/prisma/client.js";

export class RecommendationRepository {
	constructor(private prisma: PrismaClient) {}

	/**
	 * Finds communities with high post activity that the user has not joined yet.
	 */
	async getSuggestedCommunities(userId: string, limit: number) {
		return await this.prisma.community.findMany({
			where: {
				members: {
					none: { userId },
				},
			},
			take: limit,
			orderBy: {
				posts: {
					_count: "desc",
				},
			},
			select: {
				id: true,
				name: true,
				slug: true,
				_count: {
					select: { members: true, posts: true },
				},
			},
		});
	}

	/**
	 * Gets fallback high-engagement global communities for anonymous guests.
	 */
	async getGlobalSuggestedCommunities(limit: number) {
		return await this.prisma.community.findMany({
			take: limit,
			orderBy: {
				members: { _count: "desc" },
			},
			select: {
				id: true,
				name: true,
				slug: true,
				_count: {
					select: { members: true, posts: true },
				},
			},
		});
	}

	/**
	 * Identifies community IDs where the user has actively upvoted posts.
	 */
	async getUserInteractedCommunityIds(
		userId: string,
		limit = 5,
	): Promise<string[]> {
		const votes = await this.prisma.vote.findMany({
			where: {
				userId,
				type: "UPVOTE",
				post: { deletedAt: null },
			},
			// Sample a fixed window of recent votes rather than the user's whole
			// history: enough signal to infer affinity without an unbounded scan.
			orderBy: { createdAt: "desc" },
			take: 50,
			select: {
				post: {
					select: { communityId: true },
				},
			},
		});

		const ids = votes
			.map((v) => v.post?.communityId)
			.filter((id): id is string => !!id);

		// Deduplicate before slicing: many votes cluster in the same community, so
		// slicing first would yield far fewer than `limit` distinct communities.
		return [...new Set(ids)].slice(0, limit);
	}

	/**
	 * Pulls recent posts from the user's affinity communities, excluding their
	 * own so recommendations do not surface content they wrote.
	 */
	async getRecommendedPostsFromCommunities(
		userId: string,
		communityIds: string[],
		limit: number,
	) {
		return await this.prisma.post.findMany({
			where: {
				communityId: { in: communityIds },
				authorId: { not: userId },
				deletedAt: null,
			},
			take: limit,
			orderBy: {
				createdAt: "desc",
			},
			include: {
				author: { select: { username: true } },
				community: { select: { name: true, slug: true } },
				_count: { select: { comments: true } },
			},
		});
	}
}
