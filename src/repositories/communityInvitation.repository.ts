import type { PrismaClient } from "../generated/prisma/client.js";
import { InvitationStatus, MembershipRole } from "../generated/prisma/enums.js";

export class CommunityInvitationRepository {
	constructor(private readonly prisma: PrismaClient) {}

	async findPending(communityId: string, inviteeId: string) {
		return await this.prisma.communityInvitation.findFirst({
			where: { communityId, inviteeId, status: InvitationStatus.PENDING },
		});
	}

	async create(data: {
		communityId: string;
		inviteeId: string;
		inviterId: string;
		expiresAt: Date;
	}) {
		return await this.prisma.communityInvitation.create({ data });
	}

	async accept(id: string, inviteeId: string) {
		return await this.prisma.$transaction(async (tx) => {
			const invitation = await tx.communityInvitation.findUnique({
				where: { id },
			});
			if (!invitation || invitation.inviteeId !== inviteeId) return null;
			if (
				invitation.status !== InvitationStatus.PENDING ||
				invitation.expiresAt <= new Date()
			) {
				if (invitation.status === InvitationStatus.PENDING)
					await tx.communityInvitation.update({
						where: { id },
						data: { status: InvitationStatus.EXPIRED, respondedAt: new Date() },
					});
				return null;
			}
			await tx.membership.upsert({
				where: {
					userId_communityId: {
						userId: inviteeId,
						communityId: invitation.communityId,
					},
				},
				update: {},
				create: {
					userId: inviteeId,
					communityId: invitation.communityId,
					role: MembershipRole.MEMBER,
				},
			});
			return await tx.communityInvitation.update({
				where: { id },
				data: { status: InvitationStatus.ACCEPTED, respondedAt: new Date() },
			});
		});
	}

	async decline(id: string, inviteeId: string) {
		return await this.prisma.communityInvitation.updateMany({
			where: {
				id,
				inviteeId,
				status: InvitationStatus.PENDING,
				expiresAt: { gt: new Date() },
			},
			data: { status: InvitationStatus.DECLINED, respondedAt: new Date() },
		});
	}
}
