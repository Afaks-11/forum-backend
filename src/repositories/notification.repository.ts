import type { PrismaClient } from "../generated/prisma/client.js";

export type NotificationType =
	| "NEW_FOLLOWER"
	| "REPLY"
	| "COMMENT"
	| "MOD_ACTION"
	| "COMMUNITY_INVITE";

export class NotificationRepository {
	constructor(private readonly prisma: PrismaClient) {}

	/**
	 * Find a single notification by its unique database ID
	 */
	async findById(id: string) {
		return await this.prisma.notification.findUnique({
			where: { id },
		});
	}

	/**
	 * Retrieve all notifications for a recipient, sorted chronologically (newest first)
	 */
	async findAllByRecipientId(recipientId: string) {
		return await this.prisma.notification.findMany({
			where: { recipientId },
			include: { sender: { select: { username: true } } },
			orderBy: { createdAt: "desc" },
		});
	}

	/**
	 * Retrieve unread notifications for a recipient, sorted chronologically (newest first)
	 */
	async findUnreadByRecipientId(recipientId: string) {
		return await this.prisma.notification.findMany({
			where: { recipientId, isRead: false },
			include: { sender: { select: { username: true } } },
			orderBy: { createdAt: "desc" },
		});
	}

	/**
	 * Update the read status of a single notification
	 */
	async updateReadStatus(id: string, isRead: boolean) {
		return await this.prisma.notification.update({
			where: { id },
			data: { isRead },
		});
	}

	/**
	 * Bulk update the read status of all unread notifications for a recipient
	 */
	async updateManyReadStatusByRecipient(recipientId: string, isRead: boolean) {
		return await this.prisma.notification.updateMany({
			where: { recipientId, isRead: !isRead },
			data: { isRead },
		});
	}

	/**
	 * Permanently delete a single notification record
	 */
	async delete(id: string) {
		return await this.prisma.notification.delete({
			where: { id },
		});
	}

	/**
	 * Create and write a new system notification
	 */
	async create(data: {
		recipientId: string;
		senderId?: string | undefined;
		type: NotificationType;
		title: string;
		content: string;
		link?: string | undefined;
	}) {
		return await this.prisma.notification.create({
			data: {
				type: data.type,
				title: data.title,
				content: data.content,
				link: data.link ?? null,
				recipient: { connect: { id: data.recipientId } },
				...(data.senderId
					? { sender: { connect: { id: data.senderId } } }
					: {}),
			},
		});
	}
}
