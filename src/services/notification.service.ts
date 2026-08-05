import { AppError } from "../errors/AppError.js";
import { notificationQueue } from "../queues/notification.queue.js";
import { notificationRepository } from "../repositories/index.js";

export const getAllNotifications = async (recipientId: string) => {
	return await notificationRepository.findAllByRecipientId(recipientId);
};

export const getUnreadNotifications = async (recipientId: string) => {
	return await notificationRepository.findUnreadByRecipientId(recipientId);
};

/**
 * Marks one notification read, rejecting callers who are not its recipient.
 */
export const markNotificationAsRead = async (
	id: string,
	recipientId: string,
) => {
	const notification = await notificationRepository.findById(id);
	if (!notification) throw new AppError("Notification target not found", 404);
	if (notification.recipientId !== recipientId)
		throw new AppError("Forbidden adjustment action", 403);

	return await notificationRepository.updateReadStatus(id, true);
};

export const markAllNotificationsAsRead = async (recipientId: string) => {
	return await notificationRepository.updateManyReadStatusByRecipient(
		recipientId,
		true,
	);
};

export const deleteNotification = async (id: string, recipientId: string) => {
	const notification = await notificationRepository.findById(id);
	if (!notification) throw new AppError("Notification not found", 404);
	if (notification.recipientId !== recipientId)
		throw new AppError("Forbidden action", 403);

	return await notificationRepository.delete(id);
};

/**
 * Queues a notification for realtime/email delivery by the notification worker.
 * Self-triggered actions (user commenting on their own post) are suppressed to
 * avoid noise; no one needs to be notified about what they just did themselves.
 */
export const sendInternalNotification = async (payload: {
	recipientId: string;
	senderId?: string;
	type:
		| "NEW_FOLLOWER"
		| "REPLY"
		| "COMMENT"
		| "MOD_ACTION"
		| "COMMUNITY_INVITE";
	title: string;
	content: string;
	link?: string;
}) => {
	// Suppress notifications the user triggered on their own content: no one
	// wants an alert that they replied to their own comment.
	if (payload.senderId === payload.recipientId) return null;

	return await notificationQueue.add(
		`notification:recipient:${payload.recipientId}`,
		payload,
	);
};
