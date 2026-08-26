import { AppError } from "../errors/AppError.js";
import { MembershipRole } from "../generated/prisma/enums.js";
import { communityRepository } from "../repositories/index.js";
import { prisma } from "../utils/prisma.js";
import { redis } from "../utils/redis.js";
import type {
	CommunitySearchInput,
	CreateCommunityInput,
} from "../validators/community.validator.js";
import { sendInternalNotification } from "./notification.service.js";

type CommunityPayload = NonNullable<
	Awaited<ReturnType<typeof communityRepository.findBySlug>>
>;
type CommunityListPayload = Awaited<
	ReturnType<typeof communityRepository.findAllCommunitiesWithMemberCount>
>;
type CommunityFeedPayload = Awaited<
	ReturnType<typeof communityRepository.findPostsByCommunityId>
>;

/**
 * Resolves a community by slug through a 24-hour cache.
 * Shared by every slug-addressed operation below, so a miss is read once and
 * reused rather than refetched per call site.
 */
const getCommunityBySlug = async (slug: string) => {
	const cacheKey = `community:slug:${slug}`;

	const cached = await redis.get<CommunityPayload>(cacheKey);
	if (cached) return cached;

	const community = await communityRepository.findBySlug(slug);
	if (!community) throw new AppError("Community not found", 404);

	await redis.set(cacheKey, community, 86400);
	return community;
};

const checkModPermission = async (communityId: string, userId: string) => {
	const membership = await communityRepository.findMembership(
		userId,
		communityId,
	);
	if (!membership || membership.role !== MembershipRole.MODERATOR) {
		throw new AppError("Forbidden: Moderator privileges required", 403);
	}
};

/**
 * Creates a community and installs its creator as the first moderator.
 * Name and slug are both checked because the slug is a lowercased name and two
 * differently-cased names would otherwise collide on the slug unique index.
 */
export const createCommunity = async (
	data: CreateCommunityInput,
	creatorId: string,
) => {
	const slug = data.name.toLowerCase();
	const existing = await communityRepository.findByNameOrSlug(data.name, slug);
	if (existing) {
		throw new AppError("A community with this name already exists", 409);
	}

	const newCommunity = await communityRepository.createWithModerator({
		name: data.name,
		slug,
		description: data.description as string,
		creatorId: creatorId,
	});

	await redis.del("communities:list");
	return newCommunity;
};

export const getAllCommunitiesList = async () => {
	const cacheKey = "communities:list";

	const cachedList = await redis.get<CommunityListPayload>(cacheKey);
	if (cachedList) return cachedList;

	const list = await communityRepository.findAllCommunitiesWithMemberCount();
	await redis.set(cacheKey, list, 1800);
	return list;
};

export const getCommunityDetails = async (slug: string) => {
	return await getCommunityBySlug(slug);
};

/**
 * Adds the caller as a MEMBER, or leaves an existing role untouched on re-join.
 */
export const joinCommunityAction = async (userId: string, slug: string) => {
	const group = await getCommunityBySlug(slug);
	await communityRepository.upsertMembership(
		userId,
		group.id,
		MembershipRole.MEMBER,
	);

	// Both the community record and the list carry member counts, so a
	// membership change makes each stale.
	await redis.del(`community:slug:${slug}`);
	await redis.del("communities:list");
};

export const leaveCommunityAction = async (
	userId: string,
	slug: string,
	replacementUserId?: string | null,
) => {
	const group = await getCommunityBySlug(slug);
	if (!group) {
		throw new AppError("Community not found", 404);
	}

	const membership = await communityRepository.findMembership(userId, group.id);
	if (!membership) {
		throw new AppError("This user is not a member of this community", 404);
	}

	if (membership.role === MembershipRole.MODERATOR) {
		const moderatorCount = await communityRepository.countModerators(group.id);

		if (moderatorCount <= 1) {
			const membersCount = await communityRepository.getMembersCount(group.id);

			if (membersCount <= 1) {
				await communityRepository.softDelete(group.id);
				await redis.del(`community:slug:${slug}`);
				await redis.del("communities:list");
				return;
			}

			let nextModeratorId = replacementUserId;

			if (!nextModeratorId || nextModeratorId === userId) {
				const members = await communityRepository.findMembershipsByCommunityId(
					group.id,
					"MEMBER",
				);
				const eligibleMembers = members.filter((m) => m.userId !== userId);

				if (eligibleMembers.length > 0) {
					const randomIndex = Math.floor(
						Math.random() * eligibleMembers.length,
					);
					nextModeratorId = eligibleMembers[randomIndex]?.userId;
				}
			}

			if (nextModeratorId) {
				await communityRepository.updateMembershipRole(
					group.id,
					nextModeratorId,
					MembershipRole.MODERATOR,
				);
			}
		}
	}

	await communityRepository.deleteMembership(userId, group.id);

	await redis.del(`community:slug:${slug}`);
	await redis.del("communities:list");
};

export const getCommunityPostsFeed = async (slug: string) => {
	const cacheKey = `feed:community:${slug}`;

	const cachedFeed = await redis.get<CommunityFeedPayload>(cacheKey);
	if (cachedFeed) return cachedFeed;

	const group = await getCommunityBySlug(slug);
	const feed = await communityRepository.findPostsByCommunityId(group.id);

	await redis.set(cacheKey, feed, 300);
	return feed;
};

/**
 * Lists memberships for a community, optionally narrowed to a single role.
 */
export const getGroupRoster = async (
	slug: string,
	roleType?: "MEMBER" | "MODERATOR",
) => {
	const group = await getCommunityBySlug(slug);
	const role = roleType ? (roleType as MembershipRole) : undefined;
	return communityRepository.findMembershipsByCommunityId(group.id, role);
};

export const updateCommunityFields = async (
	slug: string,
	userId: string,
	description?: string,
) => {
	const group = await getCommunityBySlug(slug);
	await checkModPermission(group.id, userId);

	const result = await communityRepository.updateDescription(
		group.id,
		description ?? null,
	);

	await redis.del(`community:slug:${slug}`);
	return result;
};

export const updateCommunityRulesText = async (
	slug: string,
	userId: string,
	rules: string,
) => {
	const group = await getCommunityBySlug(slug);
	await checkModPermission(group.id, userId);

	const result = await communityRepository.updateRules(group.id, rules);

	await redis.del(`community:slug:${slug}`);
	return result;
};

export const updateCommunityMediaAsset = async (
	slug: string,
	userId: string,
	targetType: "avatar" | "banner",
	url: string,
) => {
	const group = await getCommunityBySlug(slug);
	await checkModPermission(group.id, userId);

	const updatePayload =
		targetType === "avatar" ? { avatarUrl: url } : { bannerUrl: url };

	const result = await communityRepository.updateMediaAsset(
		group.id,
		updatePayload,
	);

	await redis.del(`community:slug:${slug}`);
	return result;
};

/**
 * Permanently removes a community. Restricted to the original creator —
 * moderator rights are not sufficient for a destructive, irreversible action.
 */
export const deleteCommunityAction = async (slug: string, userId: string) => {
	const group = await getCommunityBySlug(slug);
	if (!group) {
		throw new AppError("Community not found", 404);
	}

	if (group.creatorId !== userId) {
		throw new AppError(
			"Only the original creator can delete this community",
			403,
		);
	}

	const communityPosts = await communityRepository.findPostsByCommunityId(
		group.id,
	);

	await communityRepository.softDelete(group.id);

	const keysToEvict = [
		`community:slug:${slug}`,
		"communities:list",
		`feed:community:${slug}`,
		...communityPosts.map((post) => `post:${post.id}`),
	];

	if (keysToEvict.length > 0) {
		await redis.del(keysToEvict);
	}

	await redis.del(`community:slug:${slug}`);
	await redis.del("communities:list");
	await redis.del(`feed:community:${slug}`);
};

/**
 * Notifies a user that they have been invited to a community.
 * Sends an invitation notification only; it does not create a membership.
 */
export const inviteUserToCommunitySpace = async (
	communitySlug: string,
	targetUsername: string,
	senderId: string,
) => {
	const community = await prisma.community.findUnique({
		where: { slug: communitySlug },
	});
	if (!community) throw new AppError("Target space workspace not found", 404);

	const targetUser = await prisma.user.findUnique({
		where: { username: targetUsername },
	});
	if (!targetUser)
		throw new AppError(`User account '@${targetUsername}' does not exist`, 404);

	return await sendInternalNotification({
		recipientId: targetUser.id,
		senderId,
		type: "COMMUNITY_INVITE",
		title: `Invitation to join r/${community.name}`,
		content: `You have been explicitly invited to join and participate inside the ${community.name} group network!`,
		link: `/communities/${community.slug}`,
	});
};

/**
 * Grants MODERATOR to a target user, creating their membership if absent.
 * Only an existing moderator of the same community may appoint another.
 */
export async function assignModeratorRole(
	communityId: string,
	targetUserId: string,
	currentUserId: string,
): Promise<{ message: string }> {
	const executingMembership = await prisma.membership.findFirst({
		where: {
			communityId,
			userId: currentUserId,
			role: MembershipRole.MODERATOR,
		},
	});

	if (!executingMembership) {
		throw new AppError(
			"Forbidden: Only active moderators can appoint new team members.",
			403,
		);
	}

	const targetMembership = await communityRepository.findMembership(
		targetUserId,
		communityId,
	);

	if (targetMembership?.role === MembershipRole.MODERATOR) {
		return {
			message: "User is already an active moderator of this community space.",
		};
	}

	if (targetMembership) {
		await communityRepository.updateMembershipRole(
			communityId,
			targetUserId,
			MembershipRole.MODERATOR,
		);
	} else {
		await communityRepository.createMembership(
			communityId,
			targetUserId,
			MembershipRole.MODERATOR,
		);
	}

	const community = await prisma.community.findUnique({
		where: { id: communityId },
	});
	if (community) {
		await redis.del(`community:slug:${community.slug}`);
	}

	return {
		message: "Target user successfully granted community moderator privileges.",
	};
}

/**
 * Demotes a moderator back to MEMBER, refusing to remove the last one.
 */
export async function revokeModeratorRole(
	communityId: string,
	targetUserId: string,
	currentUserId: string,
): Promise<{ message: string }> {
	const executingMembership = await communityRepository.findModeratorMembership(
		currentUserId,
		communityId,
	);

	if (!executingMembership) {
		throw new AppError(
			"Forbidden: Only active moderators possess structural authority to demote staff.",
			403,
		);
	}

	const targetMembership = await communityRepository.findMembership(
		targetUserId,
		communityId,
	);

	if (!targetMembership) {
		throw new AppError(
			"Not Found: Target user is not an active moderator for this community.",
			404,
		);
	}

	// Refuse to demote the last moderator: the community would be left with no
	// one able to moderate it or appoint a replacement.
	const totalModsRemaining =
		await communityRepository.countModerators(communityId);

	if (totalModsRemaining <= 1) {
		throw new AppError(
			"Bad Request: You cannot leave this community without at least one active administrator.",
			400,
		);
	}

	await communityRepository.updateMembershipRole(
		communityId,
		targetUserId,
		MembershipRole.MEMBER,
	);

	const community = await prisma.community.findUnique({
		where: { id: communityId },
	});
	if (community) {
		await redis.del(`community:slug:${community.slug}`);
	}

	return {
		message:
			"Target user successfully removed from the community moderator panel.",
	};
}

/**
 * Full-text community search, cached per normalized query and limit.
 */
export const searchForCommunities = async (data: CommunitySearchInput) => {
	// Lowercased and trimmed so that equivalent queries share one cache entry.
	const normalizedQuery = data.query.toLowerCase().trim();
	const cacheKey = `search:communities:${normalizedQuery}:limit:${data.limit}`;
	const TTL_SECONDS = 300; // 5-minute cache lifespan

	const cached = await redis.get(cacheKey);
	if (cached) return cached;

	const communities = await communityRepository.searchCommunities(
		data.query,
		data.limit,
	);
	await redis.set(cacheKey, communities, TTL_SECONDS);

	return communities;
};
