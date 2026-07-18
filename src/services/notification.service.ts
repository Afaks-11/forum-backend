import { AppError } from "../errors/AppError.js";
import { notificationQueue } from "../queues/notification.queue.js";
import { notificationRepository } from "../repositories/index.js";

export const getAllNotifications = async (recipientId: string) => {
	return await notificationRepository.findAllByRecipientId(recipientId);
};

export const getUnreadNotifications = async (recipientId: string) => {
	return await notificationRepository.findUnreadByRecipientId(recipientId);
};

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
	// If the user triggers an action on their own stuff, suppress the alert
	if (payload.senderId === payload.recipientId) return null;

	return await notificationQueue.add(
		`notification:recipient:${payload.recipientId}`,
		payload,
	);
};
