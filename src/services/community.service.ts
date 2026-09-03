import { AppError } from "../errors/AppError.js";
import { MembershipRole } from "../generated/prisma/enums.js";
import {
	communityInvitationRepository,
	communityRepository,
	userRepository,
} from "../repositories/index.js";
import { redis } from "../utils/redis.js";
import { isAdmin } from "../utils/roles.js";
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

const createCommunitySlug = (name: string): string =>
	name
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-+|-+$/g, "");

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
	const user = await userRepository.findById(userId);
	if (isAdmin(user?.role)) return;

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
	const slug = createCommunitySlug(data.name);
	if (slug.length < 2) {
		throw new AppError("Community name cannot produce a valid slug", 400);
	}

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
	data: {
		name?: string | undefined;
		slug?: string | undefined;
		description?: string | undefined;
	},
) => {
	const group = await getCommunityBySlug(slug);
	await checkModPermission(group.id, userId);

	const normalizedSlug = data.slug
		? createCommunitySlug(data.slug)
		: group.slug;

	const updateData = {
		...data,
		...(data.slug ? { slug: normalizedSlug } : {}),
	};
	if (data.name || data.slug) {
		const conflict = await communityRepository.findByNameOrSlugExcludingId(
			data.name ?? group.name,
			normalizedSlug ?? group.slug,
			group.id,
		);
		if (conflict)
			throw new AppError(
				"A community with this name or slug already exists",
				409,
			);
	}

	const result = await communityRepository.updateFields(group.id, updateData);

	await redis.del(`community:slug:${slug}`);
	if (data.slug && data.slug !== slug)
		await redis.del(`community:slug:${data.slug}`);
	await redis.del("communities:list");
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
	const community = await communityRepository.findBySlug(communitySlug);
	if (!community) throw new AppError("Target space workspace not found", 404);

	const senderMembership = await communityRepository.findMembership(
		senderId,
		community.id,
	);
	if (!senderMembership) {
		throw new AppError("Only community members can invite other users", 403);
	}

	const targetUser = await userRepository.findByUsername(targetUsername);
	if (!targetUser) {
		throw new AppError(`User account '@${targetUsername}' does not exist`, 404);
	}
	if (targetUser.id === senderId) {
		throw new AppError("You cannot invite to a community space", 400);
	}

	const targetMembership = await communityRepository.findMembership(
		targetUser.id,
		community.id,
	);
	if (targetMembership) {
		throw new AppError("This user is already a member of this community", 400);
	}
	const existingInvitation = await communityInvitationRepository.findPending(
		community.id,
		targetUser.id,
	);
	if (existingInvitation) {
		throw new AppError("This user already has a pending invitation", 409);
	}
	const invitation = await communityInvitationRepository.create({
		communityId: community.id,
		inviteeId: targetUser.id,
		inviterId: senderId,
		expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
	});

	return await sendInternalNotification({
		recipientId: targetUser.id,
		senderId,
		type: "COMMUNITY_INVITE",
		dedupeKey: `${community.id}:${senderId}:${targetUser.id}`,
		title: `Invitation to join ${community.name}`,
		content: `You have been explicitly invited to join and participate inside the ${community.name} group network!`,
		link: `/community-invitations/${invitation.id}`,
	});
};

export const acceptCommunityInvitation = async (
	invitationId: string,
	userId: string,
) => {
	const invitation = await communityInvitationRepository.accept(
		invitationId,
		userId,
	);
	if (!invitation)
		throw new AppError(
			"Invitation is invalid, expired, or not addressed to you",
			404,
		);
	const community = await communityRepository.findById(invitation.communityId);
	if (community) await redis.del(`community:slug:${community.slug}`);
	await redis.del("communities:list");
	return invitation;
};

export const declineCommunityInvitation = async (
	invitationId: string,
	userId: string,
) => {
	const result = await communityInvitationRepository.decline(
		invitationId,
		userId,
	);
	if (result.count === 0)
		throw new AppError(
			"Invitation is invalid, expired, or not addressed to you",
			404,
		);
	return { message: "Community invitation declined." };
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
	const executingMembership = await communityRepository.findModeratorMembership(
		currentUserId,
		communityId,
	);

	if (!executingMembership) {
		throw new AppError(
			"Forbidden: Only active moderators can appoint new team members.",
			403,
		);
	}

	await communityRepository.promoteMembership(communityId, targetUserId);

	const community = await communityRepository.findById(communityId);
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

	const updated = await communityRepository.demoteModeratorIfAnotherExists(
		communityId,
		targetUserId,
	);

	if (updated === 0) {
		throw new AppError(
			"Bad Request: You cannot leave this community without at least one active administrator.",
			400,
		);
	}

	const community = await communityRepository.findById(communityId);
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
