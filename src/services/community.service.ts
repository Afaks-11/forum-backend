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
	ReturnType<typeof communityRepository.findAllWithMemberCount>
>;
type CommunityFeedPayload = Awaited<
	ReturnType<typeof communityRepository.findPostsByCommunityId>
>;

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

	const list = await communityRepository.findAllWithMemberCount();
	await redis.set(cacheKey, list, 1800);
	return list;
};

export const getCommunityDetails = async (slug: string) => {
	return await getCommunityBySlug(slug);
};

export const joinCommunityAction = async (userId: string, slug: string) => {
	const group = await getCommunityBySlug(slug);
	await communityRepository.upsertMembership(
		userId,
		group.id,
		MembershipRole.MEMBER,
	);

	await redis.del(`community:slug:${slug}`);
	await redis.del("communities:list");
};

export const leaveCommunityAction = async (userId: string, slug: string) => {
	const group = await getCommunityBySlug(slug);
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

export const deleteCommunityAction = async (slug: string, userId: string) => {
	const group = await getCommunityBySlug(slug);
	if (group.creatorId !== userId)
		throw new AppError(
			"Only the original creator can delete this community",
			403,
		);
	await communityRepository.delete(group.id);

	await redis.del(`community:slug:${slug}`);
	await redis.del("communities:list");
	await redis.del(`feed:community:${slug}`);
};

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

export const searchForCommunities = async (data: CommunitySearchInput) => {
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
