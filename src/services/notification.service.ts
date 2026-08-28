import crypto from "node:crypto";
import { AppError } from "../errors/AppError.js";
import {
	type NotificationJobData,
	notificationQueue,
} from "../queues/notification.queue.js";
import { notificationRepository } from "../repositories/index.js";
import { logger } from "../utils/logger.js";
import { getTraceId } from "../utils/requestContext.js";

export const getAllNotifications = async (
	recipientId: string,
	query: { limit: number; cursor?: string },
) => {
	return await notificationRepository.findAllByRecipientId(
		recipientId,
		query.limit,
		query.cursor,
	);
};

export const getUnreadNotifications = async (
	recipientId: string,
	query: { limit: number; cursor?: string },
) => {
	return await notificationRepository.findUnreadByRecipientId(
		recipientId,
		query.limit,
		query.cursor,
	);
};

export const getUnreadNotificationCount = async (recipientId: string) => ({
	count: await notificationRepository.countUnreadByRecipientId(recipientId),
});

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
 * Derives the BullMQ job id used to deduplicate notification enqueues.
 *
 * Producers call `sendInternalNotification` after their row has committed, so a
 * client that retries a request whose response never arrived would otherwise
 * add one duplicate notification per attempt. Fingerprinting the whole payload
 * rather than just `recipient:type` collapses byte-identical repeats while
 * keeping genuinely distinct notifications separate.
 */
const buildDedupeJobId = (payload: NotificationJobData): string => {
	const fingerprint = `${payload.recipientId}|${payload.type}|${payload.dedupeKey}`;

	return `notification-${crypto
		.createHash("sha1")
		.update(fingerprint)
		.digest("hex")}`;
};

/**
 * Queues a notification for realtime delivery by the notification worker.
 *
 * Two policies are centralized here so no caller has to repeat them:
 *
 * 1. Self-triggered actions (a user commenting on their own post) are
 *    suppressed; no one needs an alert about what they just did themselves.
 * 2. Enqueue failures are logged and swallowed. Every producer calls this
 *    *after* its database write has committed, so propagating a Redis outage
 *    would turn an operation that already succeeded into a 500 — and the
 *    client's retry would duplicate the committed row. Realtime delivery is
 *    best-effort on top of the write, exactly like the socket emit that
 *    follows it.
 */
export const sendInternalNotification = async (
	payload: NotificationJobData,
) => {
	// Suppress notifications the user triggered on their own content: no one
	// wants an alert that they replied to their own comment.
	if (payload.senderId === payload.recipientId) return null;

	const traceId = getTraceId();
	const jobData: NotificationJobData = {
		...payload,
		...(traceId ? { traceId } : {}),
	};

	try {
		const jobId = payload.dedupeKey ? buildDedupeJobId(payload) : undefined;
		const name = `notification:recipient:${payload.recipientId}`;
		return jobId
			? await notificationQueue.add(name, jobData, { jobId })
			: await notificationQueue.add(name, jobData);
	} catch (error) {
		logger.error(
			{
				err: error,
				recipientId: payload.recipientId,
				type: payload.type,
				traceId,
			},
			"Failed to enqueue notification; the originating write is unaffected.",
		);
		return null;
	}
};
