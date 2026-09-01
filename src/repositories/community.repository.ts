import type { PrismaClient } from "../generated/prisma/client.js";
import { MembershipRole } from "../generated/prisma/enums.js";
import { postListInclude } from "./post.repository.js";

export class CommunityRepository {
	constructor(private readonly prisma: PrismaClient) {}

	async findById(id: string) {
		return await this.prisma.community.findFirst({
			where: { id, deletedAt: null },
		});
	}

	/**
	 * Checks both unique columns at once, since a new community can collide on
	 * either the display name or the derived slug.
	 */
	async findByNameOrSlug(name: string, slug: string) {
		return await this.prisma.community.findFirst({
			where: {
				deletedAt: null,
				OR: [{ name }, { slug }],
			},
		});
	}

	/**
	 * Creates a community and its creator's MODERATOR membership in one
	 * transaction, so a failure cannot leave a community with no moderator and
	 * therefore no one able to appoint one.
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
		return await this.prisma.community.findFirst({
			where: { slug, deletedAt: null },
		});
	}

	/**
	 * Fetch list of all communities with aggregated membership counters
	 */
	async findAllCommunitiesWithMemberCount() {
		return await this.prisma.community.findMany({
			where: { deletedAt: null },
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
	 * Joins a community without downgrading an existing role: the empty update
	 * means a moderator who re-joins is not reset to MEMBER.
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
	 * Leaves a community. `deleteMany` keeps a repeated leave from throwing.
	 */
	async deleteMembership(userId: string, communityId: string) {
		return await this.prisma.membership.deleteMany({
			where: { communityId, userId },
		});
	}

	/**
	 * Query feed posts originating from a specific community
	 */
	async findPostsByCommunityId(communityId: string, limit = 50) {
		return await this.prisma.post.findMany({
			where: { communityId, deletedAt: null },
			take: limit,
			include: postListInclude,
			orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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
				community: { deletedAt: null },
				communityId,
				...(role && { role }),
			},
			select: { role: true, createdAt: true, userId: true },
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
	async softDelete(communityId: string) {
		return await this.prisma.community.update({
			where: { id: communityId },
			data: { deletedAt: new Date() },
		});
	}

	/**
	 * Counts moderators, used to block demoting the last one.
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

	async promoteMembership(communityId: string, userId: string) {
		return await this.prisma.membership.upsert({
			where: { userId_communityId: { userId, communityId } },
			update: { role: MembershipRole.MODERATOR },
			create: { communityId, userId, role: MembershipRole.MODERATOR },
		});
	}

	async demoteModeratorIfAnotherExists(communityId: string, userId: string) {
		return await this.prisma.$transaction(async (tx) => {
			// Serialize moderator removals per community. A plain count-then-update
			// lets two concurrent requests both observe two moderators and demote
			// both; the transaction-scoped advisory lock makes the second request
			// re-evaluate only after the first commits.
			await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${communityId}))`;
			const count = await tx.membership.count({
				where: { communityId, role: MembershipRole.MODERATOR },
			});
			if (count <= 1) return 0;

			const result = await tx.membership.updateMany({
				where: { communityId, userId, role: MembershipRole.MODERATOR },
				data: { role: MembershipRole.MEMBER },
			});
			return result.count;
		});
	}

	/**
	 * Case-insensitive search across community names and slugs.
	 */
	async searchCommunities(query: string, limit: number) {
		return await this.prisma.community.findMany({
			where: {
				deletedAt: null,
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

	/**
	 * Fetch the number of users in a community
	 */
	async getMembersCount(id: string) {
		return await this.prisma.membership.count({
			where: {
				communityId: id,
			},
		});
	}
}
