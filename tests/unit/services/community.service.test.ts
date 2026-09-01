import { describe, expect, it, jest } from "@jest/globals";
import { AppError } from "../../../src/errors/AppError.js";
import { MembershipRole } from "../../../src/generated/prisma/enums.js";

// Module Level Repository and Core Subsystem Mocks
const mockCommunityRepository = {
	findById: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	findByNameOrSlug: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	createWithModerator: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	findBySlug: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	findAllCommunitiesWithMemberCount:
		jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	findMembership: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	findModeratorMembership: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	upsertMembership: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	deleteMembership: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	findPostsByCommunityId: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	findMembershipsByCommunityId:
		jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	updateDescription: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	updateRules: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	updateMediaAsset: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	softDelete: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	countModerators: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	updateMembershipRole: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	createMembership: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	promoteMembership: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	demoteModeratorIfAnotherExists:
		jest.fn<(...args: unknown[]) => Promise<number>>(),
	searchCommunities: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
};

const mockUserRepository = {
	findByUsername: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
};

const mockRedis = {
	get: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	set: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	del: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
};

const mockSendInternalNotification =
	jest.fn<(...args: unknown[]) => Promise<unknown>>();

await jest.unstable_mockModule("../../../src/repositories/index.js", () => ({
	communityRepository: mockCommunityRepository,
	userRepository: mockUserRepository,
}));
await jest.unstable_mockModule("../../../src/utils/redis.js", () => ({
	redis: mockRedis,
}));
await jest.unstable_mockModule(
	"../../../src/services/notification.service.js",
	() => ({
		sendInternalNotification: mockSendInternalNotification,
	}),
);

// Load targeted service operations post isolation boundary execution
const {
	createCommunity,
	getAllCommunitiesList,
	getCommunityDetails,
	joinCommunityAction,
	leaveCommunityAction,
	getCommunityPostsFeed,
	getGroupRoster,
	updateCommunityFields,
	updateCommunityRulesText,
	updateCommunityMediaAsset,
	deleteCommunityAction,
	inviteUserToCommunitySpace,
	assignModeratorRole,
	revokeModeratorRole,
	searchForCommunities,
} = await import("../../../src/services/community.service.js");

const { createFakeCommunity, createFakeMembership } = await import(
	"../../fixtures/community.fixture.js"
);

describe("Community Service Unit Test Suite", () => {
	describe("createCommunity", () => {
		it("Happy Path: should successfully create a new community and invalidate the global list cache", async () => {
			const input = { name: "TypeScript", description: "JS with types" };
			const creatorId = "usr_123";
			const fakeCommunity = createFakeCommunity({
				name: "TypeScript",
				slug: "typescript",
				creatorId,
			});

			mockCommunityRepository.findByNameOrSlug.mockResolvedValue(null);
			mockCommunityRepository.createWithModerator.mockResolvedValue(
				fakeCommunity,
			);

			const result = await createCommunity(input, creatorId);

			expect(mockCommunityRepository.findByNameOrSlug).toHaveBeenCalledWith(
				"TypeScript",
				"typescript",
			);
			expect(mockCommunityRepository.createWithModerator).toHaveBeenCalledWith({
				name: "TypeScript",
				slug: "typescript",
				description: "JS with types",
				creatorId,
			});
			expect(mockRedis.del).toHaveBeenCalledWith("communities:list");
			expect(result).toEqual(fakeCommunity);
		});

		it("Business Rule: should throw 409 AppError if community name or slug is already taken", async () => {
			mockCommunityRepository.findByNameOrSlug.mockResolvedValue(
				createFakeCommunity(),
			);

			await expect(
				createCommunity({ name: "Duplicate", description: "Desc" }, "usr_123"),
			).rejects.toThrow(
				new AppError("A community with this name already exists", 409),
			);
		});
	});

	describe("getAllCommunitiesList", () => {
		it("Happy Path (Cache Hit): should return cached data immediately when list key exists in cache", async () => {
			const cachedList = [createFakeCommunity()];
			mockRedis.get.mockResolvedValue(cachedList);

			const result = await getAllCommunitiesList();

			expect(mockRedis.get).toHaveBeenCalledWith("communities:list");
			expect(
				mockCommunityRepository.findAllCommunitiesWithMemberCount,
			).not.toHaveBeenCalled();
			expect(result).toEqual(cachedList);
		});

		it("Happy Path (Cache Miss): should fetch data from repository and store in redis cache on miss", async () => {
			const dbList = [{ ...createFakeCommunity(), _count: { members: 5 } }];
			mockRedis.get.mockResolvedValue(null);
			mockCommunityRepository.findAllCommunitiesWithMemberCount.mockResolvedValue(
				dbList,
			);

			const result = await getAllCommunitiesList();

			expect(
				mockCommunityRepository.findAllCommunitiesWithMemberCount,
			).toHaveBeenCalled();
			expect(mockRedis.set).toHaveBeenCalledWith(
				"communities:list",
				dbList,
				1800,
			);
			expect(result).toEqual(dbList);
		});
	});

	describe("getCommunityDetails", () => {
		it("Happy Path (Cache Hit): should fetch from redis and bypass database", async () => {
			const community = createFakeCommunity();
			mockRedis.get.mockResolvedValue(community);
			mockCommunityRepository.findMembership.mockResolvedValue({
				role: MembershipRole.MEMBER,
			});

			const result = await getCommunityDetails("typescript");

			expect(mockRedis.get).toHaveBeenCalledWith("community:slug:typescript");
			expect(mockCommunityRepository.findBySlug).not.toHaveBeenCalled();
			expect(result).toEqual(community);
		});

		it("Happy Path (Cache Miss): should fetch from repository and populate redis when cache is cold", async () => {
			const community = createFakeCommunity();
			mockRedis.get.mockResolvedValue(null);
			mockCommunityRepository.findBySlug.mockResolvedValue(community);

			const result = await getCommunityDetails("typescript");

			expect(mockCommunityRepository.findBySlug).toHaveBeenCalledWith(
				"typescript",
			);
			expect(mockRedis.set).toHaveBeenCalledWith(
				"community:slug:typescript",
				community,
				86400,
			);
			expect(result).toEqual(community);
		});

		it("Edge Case (Not Found): should throw a 404 AppError if the community does not exist in db", async () => {
			mockRedis.get.mockResolvedValue(null);
			mockCommunityRepository.findBySlug.mockResolvedValue(null);

			await expect(getCommunityDetails("unknown")).rejects.toThrow(
				new AppError("Community not found", 404),
			);
		});
	});

	describe("joinCommunityAction", () => {
		it("Happy Path: should record a new membership structure and flush specific cache keys", async () => {
			const community = createFakeCommunity();
			mockRedis.get.mockResolvedValue(community);

			await joinCommunityAction("usr_999", "typescript");

			expect(mockCommunityRepository.upsertMembership).toHaveBeenCalledWith(
				"usr_999",
				community.id,
				MembershipRole.MEMBER,
			);
			expect(mockRedis.del).toHaveBeenCalledWith("community:slug:typescript");
			expect(mockRedis.del).toHaveBeenCalledWith("communities:list");
		});
	});

	describe("leaveCommunityAction", () => {
		it("Happy Path: should remove active membership association and flush cache keys", async () => {
			const community = createFakeCommunity();
			mockRedis.get.mockResolvedValue(community);
			mockCommunityRepository.findMembership.mockResolvedValue({
				role: MembershipRole.MEMBER,
			});

			await leaveCommunityAction("usr_999", "typescript");

			expect(mockCommunityRepository.deleteMembership).toHaveBeenCalledWith(
				"usr_999",
				community.id,
			);
			expect(mockRedis.del).toHaveBeenCalledWith("community:slug:typescript");
			expect(mockRedis.del).toHaveBeenCalledWith("communities:list");
		});
	});

	describe("getCommunityPostsFeed", () => {
		it("Happy Path (Cache Hit): should return cached feed immediately", async () => {
			const cachedFeed = [{ id: "post_1", title: "Hello" }];
			mockRedis.get.mockImplementation(async (key) => {
				if (key === "feed:community:typescript") return cachedFeed;
				return null;
			});

			const result = await getCommunityPostsFeed("typescript");

			expect(result).toEqual(cachedFeed);
			expect(
				mockCommunityRepository.findPostsByCommunityId,
			).not.toHaveBeenCalled();
		});

		it("Happy Path (Cache Miss): should load posts from database and refresh hot cache data", async () => {
			const community = createFakeCommunity();
			const dbFeed = [{ id: "post_1", title: "Hello" }];

			mockRedis.get.mockResolvedValue(null);
			mockCommunityRepository.findBySlug.mockResolvedValue(community);
			mockCommunityRepository.findPostsByCommunityId.mockResolvedValue(dbFeed);

			const result = await getCommunityPostsFeed("typescript");

			expect(
				mockCommunityRepository.findPostsByCommunityId,
			).toHaveBeenCalledWith(community.id);
			expect(mockRedis.set).toHaveBeenCalledWith(
				"feed:community:typescript",
				dbFeed,
				300,
			);
			expect(result).toEqual(dbFeed);
		});
	});

	describe("getGroupRoster", () => {
		it("Happy Path: should return list of active community memberships filtered by role if supplied", async () => {
			const community = createFakeCommunity();
			mockRedis.get.mockResolvedValue(community);
			mockCommunityRepository.findMembershipsByCommunityId.mockResolvedValue(
				[],
			);

			await getGroupRoster("typescript", "MODERATOR");

			expect(
				mockCommunityRepository.findMembershipsByCommunityId,
			).toHaveBeenCalledWith(community.id, MembershipRole.MODERATOR);
		});

		it("Happy Path: should query memberships without role filtering if none is passed", async () => {
			const community = createFakeCommunity();
			mockRedis.get.mockResolvedValue(community);
			mockCommunityRepository.findMembershipsByCommunityId.mockResolvedValue(
				[],
			);

			await getGroupRoster("typescript");

			expect(
				mockCommunityRepository.findMembershipsByCommunityId,
			).toHaveBeenCalledWith(community.id, undefined);
		});
	});

	describe("updateCommunityFields", () => {
		it("Happy Path: should update description when authorized by an active moderator", async () => {
			const community = createFakeCommunity();
			mockRedis.get.mockResolvedValue(community);
			mockCommunityRepository.findMembership.mockResolvedValue(
				createFakeMembership({ role: MembershipRole.MODERATOR }),
			);
			mockCommunityRepository.updateDescription.mockResolvedValue({
				...community,
				description: "New",
			});

			const result = await updateCommunityFields(
				"typescript",
				"usr_mod",
				"New Description",
			);

			expect(mockCommunityRepository.updateDescription).toHaveBeenCalledWith(
				community.id,
				"New Description",
			);
			expect(mockRedis.del).toHaveBeenCalledWith("community:slug:typescript");
			expect(result.description).toBe("New");
		});

		it("Business Rule: should reject update with 403 AppError if executor lacks moderator privileges", async () => {
			const community = createFakeCommunity();
			mockRedis.get.mockResolvedValue(community);
			mockCommunityRepository.findMembership.mockResolvedValue(
				createFakeMembership({ role: MembershipRole.MEMBER }),
			);

			await expect(
				updateCommunityFields("typescript", "usr_member", "New"),
			).rejects.toThrow(
				new AppError("Forbidden: Moderator privileges required", 403),
			);
		});
	});

	describe("updateCommunityRulesText", () => {
		it("Happy Path: should successfully modify community rules under proper authentication", async () => {
			const community = createFakeCommunity();
			mockRedis.get.mockResolvedValue(community);
			mockCommunityRepository.findMembership.mockResolvedValue(
				createFakeMembership({ role: MembershipRole.MODERATOR }),
			);

			await updateCommunityRulesText("typescript", "usr_mod", "New Rules");

			expect(mockCommunityRepository.updateRules).toHaveBeenCalledWith(
				community.id,
				"New Rules",
			);
			expect(mockRedis.del).toHaveBeenCalledWith("community:slug:typescript");
		});
	});

	describe("updateCommunityMediaAsset", () => {
		it("Happy Path: should update avatarUrl when targetType equals avatar", async () => {
			const community = createFakeCommunity();
			mockRedis.get.mockResolvedValue(community);
			mockCommunityRepository.findMembership.mockResolvedValue(
				createFakeMembership({ role: MembershipRole.MODERATOR }),
			);

			await updateCommunityMediaAsset(
				"typescript",
				"usr_mod",
				"avatar",
				"http://avatar.png",
			);

			expect(mockCommunityRepository.updateMediaAsset).toHaveBeenCalledWith(
				community.id,
				{
					avatarUrl: "http://avatar.png",
				},
			);
		});

		it("Happy Path: should update bannerUrl when targetType equals banner", async () => {
			const community = createFakeCommunity();
			mockRedis.get.mockResolvedValue(community);
			mockCommunityRepository.findMembership.mockResolvedValue(
				createFakeMembership({ role: MembershipRole.MODERATOR }),
			);

			await updateCommunityMediaAsset(
				"typescript",
				"usr_mod",
				"banner",
				"http://banner.png",
			);

			expect(mockCommunityRepository.updateMediaAsset).toHaveBeenCalledWith(
				community.id,
				{
					bannerUrl: "http://banner.png",
				},
			);
		});
	});

	describe("deleteCommunityAction", () => {
		it("Happy Path: should delete community and wipe matching cache indexes if sender matches creator", async () => {
			const community = createFakeCommunity({ creatorId: "usr_creator" });
			mockRedis.get.mockResolvedValue(community);
			mockCommunityRepository.findPostsByCommunityId.mockResolvedValue([]);

			await deleteCommunityAction("typescript", "usr_creator");

			expect(mockCommunityRepository.softDelete).toHaveBeenCalledWith(
				community.id,
			);
			expect(mockRedis.del).toHaveBeenCalledWith("community:slug:typescript");
			expect(mockRedis.del).toHaveBeenCalledWith("communities:list");
			expect(mockRedis.del).toHaveBeenCalledWith("feed:community:typescript");
		});

		it("Business Rule: should throw 403 AppError if user attempting deletion is not the creator", async () => {
			const community = createFakeCommunity({ creatorId: "usr_creator" });
			mockRedis.get.mockResolvedValue(community);

			await expect(
				deleteCommunityAction("typescript", "usr_imposter"),
			).rejects.toThrow(
				new AppError(
					"Only the original creator can delete this community",
					403,
				),
			);
		});
	});

	describe("inviteUserToCommunitySpace", () => {
		it("Happy Path: should delegate task to notification queue system when targets exist", async () => {
			mockCommunityRepository.findBySlug.mockResolvedValue({
				id: "community_1",
				name: "TypeScript",
				slug: "typescript",
			});
			mockCommunityRepository.findMembership.mockResolvedValue({
				role: "MEMBER",
			});
			mockUserRepository.findByUsername.mockResolvedValue({ id: "usr_target" });
			mockSendInternalNotification.mockResolvedValue({ id: "job_1" });

			const result = await inviteUserToCommunitySpace(
				"typescript",
				"targetuser",
				"usr_sender",
			);

			expect(mockCommunityRepository.findBySlug).toHaveBeenCalledWith(
				"typescript",
			);
			expect(mockUserRepository.findByUsername).toHaveBeenCalledWith(
				"targetuser",
			);
			expect(mockSendInternalNotification).toHaveBeenCalledWith({
				recipientId: "usr_target",
				senderId: "usr_sender",
				type: "COMMUNITY_INVITE",
				dedupeKey: "community_1:usr_sender",
				title: "Invitation to join r/TypeScript",
				content: expect.any(String),
				link: "/communities/typescript",
			});
			expect(result).toEqual({ id: "job_1" });
		});

		it("Edge Case: should throw 404 if the target workspace does not exist", async () => {
			mockCommunityRepository.findBySlug.mockResolvedValue(null);

			await expect(
				inviteUserToCommunitySpace("missing", "targetuser", "usr_sender"),
			).rejects.toThrow(new AppError("Target space workspace not found", 404));
		});

		it("Edge Case: should throw 404 if the target recipient username does not exist", async () => {
			mockCommunityRepository.findBySlug.mockResolvedValue({
				id: "community_1",
				name: "TypeScript",
				slug: "typescript",
			});
			mockCommunityRepository.findMembership.mockResolvedValue({
				role: "MEMBER",
			});
			mockUserRepository.findByUsername.mockResolvedValue(null);

			await expect(
				inviteUserToCommunitySpace("typescript", "missinguser", "usr_sender"),
			).rejects.toThrow(
				new AppError("User account '@missinguser' does not exist", 404),
			);
		});
	});

	describe("assignModeratorRole", () => {
		it("Business Rule (Forbidden): should block assignment if executor is not an administrator", async () => {
			mockCommunityRepository.findModeratorMembership.mockResolvedValue(null);

			await expect(
				assignModeratorRole("cmnt_123", "usr_target", "usr_executor"),
			).rejects.toThrow(
				new AppError(
					"Forbidden: Only active moderators can appoint new team members.",
					403,
				),
			);
		});

		it("Happy Path (Idempotent): should safely promote an existing moderator", async () => {
			mockCommunityRepository.findModeratorMembership.mockResolvedValue({
				id: "exec_mem",
			});
			mockCommunityRepository.findMembership.mockResolvedValue({
				role: MembershipRole.MODERATOR,
			});
			mockCommunityRepository.promoteMembership.mockResolvedValue({});

			const result = await assignModeratorRole(
				"cmnt_123",
				"usr_target",
				"usr_executor",
			);

			expect(result.message).toContain("successfully granted");
			expect(mockCommunityRepository.promoteMembership).toHaveBeenCalledWith(
				"cmnt_123",
				"usr_target",
			);
		});

		it("Happy Path (Update): should promote existing member and bust community cache metadata", async () => {
			mockCommunityRepository.findModeratorMembership.mockResolvedValue({
				id: "exec_mem",
			});
			mockCommunityRepository.promoteMembership.mockResolvedValue({});
			mockCommunityRepository.findById.mockResolvedValue({
				slug: "typescript",
			});

			const result = await assignModeratorRole(
				"cmnt_123",
				"usr_target",
				"usr_executor",
			);

			expect(mockCommunityRepository.promoteMembership).toHaveBeenCalledWith(
				"cmnt_123",
				"usr_target",
			);
			expect(mockRedis.del).toHaveBeenCalledWith("community:slug:typescript");
			expect(result.message).toContain("successfully granted");
		});

		it("Happy Path (Create): should directly provision new membership record if user holds no prior relation", async () => {
			mockCommunityRepository.findModeratorMembership.mockResolvedValue({
				id: "exec_mem",
			});
			mockCommunityRepository.promoteMembership.mockResolvedValue({});
			mockCommunityRepository.findById.mockResolvedValue({
				slug: "typescript",
			});

			const result = await assignModeratorRole(
				"cmnt_123",
				"usr_target",
				"usr_executor",
			);

			expect(mockCommunityRepository.promoteMembership).toHaveBeenCalledWith(
				"cmnt_123",
				"usr_target",
			);
			expect(mockRedis.del).toHaveBeenCalledWith("community:slug:typescript");
			expect(result.message).toContain("successfully granted");
		});
	});

	describe("revokeModeratorRole", () => {
		it("Business Rule (Forbidden): should block operation if demoter lacks proper staff elevation parameters", async () => {
			mockCommunityRepository.findModeratorMembership.mockResolvedValue(null);

			await expect(
				revokeModeratorRole("cmnt_123", "usr_target", "usr_executor"),
			).rejects.toThrow(
				new AppError(
					"Forbidden: Only active moderators possess structural authority to demote staff.",
					403,
				),
			);
		});

		it("Business Rule (Not Found): should throw 404 if targeted account has no membership record", async () => {
			mockCommunityRepository.findModeratorMembership.mockResolvedValue({
				id: "exec",
			});
			mockCommunityRepository.findMembership.mockResolvedValue(null);

			await expect(
				revokeModeratorRole("cmnt_123", "usr_target", "usr_executor"),
			).rejects.toThrow(
				new AppError(
					"Not Found: Target user is not an active moderator for this community.",
					404,
				),
			);
		});

		it("Business Rule (Last Admin Safeguard): should throw 400 if removing target leaves space without administrator", async () => {
			mockCommunityRepository.findModeratorMembership.mockResolvedValue({
				id: "exec",
			});
			mockCommunityRepository.findMembership.mockResolvedValue({
				role: MembershipRole.MODERATOR,
			});
			mockCommunityRepository.demoteModeratorIfAnotherExists.mockResolvedValue(
				0,
			);

			await expect(
				revokeModeratorRole("cmnt_123", "usr_target", "usr_executor"),
			).rejects.toThrow(
				new AppError(
					"Bad Request: You cannot leave this community without at least one active administrator.",
					400,
				),
			);
		});

		it("Happy Path: should demote targeted administrator down to standard member rank when safeguards clear", async () => {
			mockCommunityRepository.findModeratorMembership.mockResolvedValue({
				id: "exec",
			});
			mockCommunityRepository.findMembership.mockResolvedValue({
				role: MembershipRole.MODERATOR,
			});
			mockCommunityRepository.demoteModeratorIfAnotherExists.mockResolvedValue(
				1,
			);
			mockCommunityRepository.findById.mockResolvedValue({
				slug: "typescript",
			});

			const result = await revokeModeratorRole(
				"cmnt_123",
				"usr_target",
				"usr_executor",
			);

			expect(
				mockCommunityRepository.demoteModeratorIfAnotherExists,
			).toHaveBeenCalledWith("cmnt_123", "usr_target");
			expect(mockRedis.del).toHaveBeenCalledWith("community:slug:typescript");
			expect(result.message).toContain(
				"successfully removed from the community moderator panel",
			);
		});
	});

	describe("searchForCommunities", () => {
		it("Happy Path (Cache Hit): should quickly pull structural payloads out of fast cache layers", async () => {
			const cachedResults = [{ id: "c1", name: "TS", slug: "ts" }];
			mockRedis.get.mockResolvedValue(cachedResults);

			const result = await searchForCommunities({ query: "ts", limit: 5 });

			expect(mockRedis.get).toHaveBeenCalledWith(
				"search:communities:ts:limit:5",
			);
			expect(mockCommunityRepository.searchCommunities).not.toHaveBeenCalled();
			expect(result).toEqual(cachedResults);
		});

		it("Happy Path (Cache Miss): should fetch matching rows through token scanning mechanisms on cold misses", async () => {
			const dbResults = [{ id: "c1", name: "TS", slug: "ts" }];
			mockRedis.get.mockResolvedValue(null);
			mockCommunityRepository.searchCommunities.mockResolvedValue(dbResults);

			const result = await searchForCommunities({ query: "  TS  ", limit: 5 });

			expect(mockCommunityRepository.searchCommunities).toHaveBeenCalledWith(
				"  TS  ",
				5,
			);
			expect(mockRedis.set).toHaveBeenCalledWith(
				"search:communities:ts:limit:5",
				dbResults,
				300,
			);
			expect(result).toEqual(dbResults);
		});
	});
});
