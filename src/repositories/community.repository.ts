import type { PrismaClient } from "../generated/prisma/client.js";
import { MembershipRole } from "../generated/prisma/enums.js";

export class CommunityRepository {
	constructor(private readonly prisma: PrismaClient) {}

	async findById(id: string) {
		return await this.prisma.community.findUnique({
			where: { id },
		});
	}

	/**
	 * Find community matching a exact name or URL slug
	 */
	async findByNameOrSlug(name: string, slug: string) {
		return await this.prisma.community.findFirst({
			where: {
				OR: [{ name }, { slug }],
			},
		});
	}

	/**
	 * Atomically create a community and its initial Moderator membership
	 */
	async createWithModerator(data: {
		name: string;
		slug: string;
		description: string;
		creatorId: string;
	}) {
		return await this.prisma.$transaction(async (tx) => {
			const community = await tx.community.create({
				data: {
					name: data.name,
					slug: data.slug,
					description: data.description,
					creatorId: data.creatorId,
				},
			});

			await tx.membership.create({
				data: {
					userId: data.creatorId,
					communityId: community.id,
					role: MembershipRole.MODERATOR,
				},
			});

			return community;
		});
	}

	/**
	 * Find a unique community profile by URL slug
	 */
	async findBySlug(slug: string) {
		return await this.prisma.community.findUnique({
			where: { slug },
		});
	}

	/**
	 * Fetch list of all communities with aggregated membership counters
	 */
	async findAllWithMemberCount() {
		return await this.prisma.community.findMany({
			include: { _count: { select: { members: true } } },
		});
	}

	/**
	 * Fetch specific membership details for a user inside a community
	 */
	async findMembership(userId: string, communityId: string) {
		return await this.prisma.membership.findUnique({
			where: { userId_communityId: { userId, communityId } },
		});
	}

	/**
	 * Verify whether a user holds an active moderator assignment
	 */
	async findModeratorMembership(userId: string, communityId: string) {
		return await this.prisma.membership.findFirst({
			where: {
				userId,
				communityId,
				role: MembershipRole.MODERATOR,
			},
		});
	}

	/**
	 * Add or reactivate community subscription membership
	 */
	async upsertMembership(
		userId: string,
		communityId: string,
		role: MembershipRole,
	) {
		return await this.prisma.membership.upsert({
			where: { userId_communityId: { userId, communityId } },
			update: {},
			create: { communityId, userId, role },
		});
	}

	/**
	 * Delete user membership association from a community
	 */
	async deleteMembership(userId: string, communityId: string) {
		return await this.prisma.membership.deleteMany({
			where: { communityId, userId },
		});
	}

	/**
	 * Query feed posts originating from a specific community
	 */
	async findPostsByCommunityId(communityId: string) {
		return await this.prisma.post.findMany({
			where: { communityId },
			orderBy: { createdAt: "desc" },
		});
	}

	/**
	 * Retrieve the active membership roster of a community filtered optionally by role
	 */
	async findMembershipsByCommunityId(
		communityId: string,
		role?: MembershipRole,
	) {
		return await this.prisma.membership.findMany({
			where: {
				communityId,
				...(role && { role }),
			},
			select: { role: true, joinedAt: true, userId: true },
		});
	}

	/**
	 * Update community generic fields
	 */
	async updateDescription(communityId: string, description: string | null) {
		return await this.prisma.community.update({
			where: { id: communityId },
			data: { description },
		});
	}

	/**
	 * Update community rules guidelines text
	 */
	async updateRules(communityId: string, rules: string) {
		return await this.prisma.community.update({
			where: { id: communityId },
			data: { rules },
		});
	}

	/**
	 * Update community branding and custom profile graphics
	 */
	async updateMediaAsset(
		communityId: string,
		data: { avatarUrl?: string; bannerUrl?: string },
	) {
		return await this.prisma.community.update({
			where: { id: communityId },
			data,
		});
	}

	/**
	 * Delete a community space permanently
	 */
	async delete(communityId: string) {
		return await this.prisma.community.delete({
			where: { id: communityId },
		});
	}

	/**
	 * Count active administrators currently assigned to a community moderation panel
	 */
	async countModerators(communityId: string) {
		return await this.prisma.membership.count({
			where: {
				communityId,
				role: MembershipRole.MODERATOR,
			},
		});
	}

	/**
	 * Update an existing user's role settings
	 */
	async updateMembershipRole(
		communityId: string,
		userId: string,
		role: MembershipRole,
	) {
		return await this.prisma.membership.updateMany({
			where: { communityId, userId },
			data: { role },
		});
	}

	/**
	 * Directly create a specific user membership profile
	 */
	async createMembership(
		communityId: string,
		userId: string,
		role: MembershipRole,
	) {
		return await this.prisma.membership.create({
			data: { communityId, userId, role },
		});
	}

	/**
	 * Finds lightweight community structures by matching name or slug partial tokens.
	 */
	async searchCommunities(query: string, limit: number) {
		return await this.prisma.community.findMany({
			where: {
				OR: [
					{ name: { contains: query, mode: "insensitive" } },
					{ slug: { contains: query, mode: "insensitive" } },
				],
			},
			take: limit,
			select: {
				id: true,
				name: true,
				slug: true,
			},
		});
	}
}
