import type { Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import {
	deleteNotification,
	getAllNotifications,
	getUnreadNotificationCount,
	getUnreadNotifications,
	markAllNotificationsAsRead,
	markNotificationAsRead,
} from "../services/notification.service.js";
import {
	notificationIdParamSchema,
	notificationListQuerySchema,
} from "../validators/notification.validator.js";

export const fetchAllNotifications = asyncHandler(
	async (req: Request, res: Response) => {
		const userId = res.locals.user.userId;
		const query = notificationListQuerySchema.parse(req.query);
		const result = await getAllNotifications(userId, {
			limit: query.limit,
			...(query.cursor ? { cursor: query.cursor } : {}),
		});
		res.status(200).json({
			success: true,
			data: result.items,
			meta: { nextCursor: result.nextCursor },
		});
	},
);

export const fetchUnreadNotification = asyncHandler(
	async (req: Request, res: Response) => {
		const query = notificationListQuerySchema.parse(req.query);
		const result = await getUnreadNotifications(res.locals.user.userId, {
			limit: query.limit,
			...(query.cursor ? { cursor: query.cursor } : {}),
		});
		res.status(200).json({
			success: true,
			data: result.items,
			meta: { nextCursor: result.nextCursor },
		});
	},
);

export const fetchUnreadNotificationCount = asyncHandler(
	async (_req: Request, res: Response) => {
		const data = await getUnreadNotificationCount(res.locals.user.userId);
		res.status(200).json({ success: true, data });
	},
);

export const readSingleNotification = asyncHandler(
	async (req: Request, res: Response) => {
		const { id } = notificationIdParamSchema.parse(req.params);
		await markNotificationAsRead(id, res.locals.user.userId);
		res
			.status(200)
			.json({ success: true, message: "Notification marked as read." });
	},
);

export const readAllNotifications = asyncHandler(
	async (_req: Request, res: Response) => {
		await markAllNotificationsAsRead(res.locals.user.userId);
		res.status(200).json({
			success: true,
			message: "All notifications marked as read.",
		});
	},
);

export const destroySingleNotification = asyncHandler(
	async (req: Request, res: Response) => {
		const { id } = notificationIdParamSchema.parse(req.params);
		await deleteNotification(id, res.locals.user.userId);
		res.status(204).end();
	},
);
