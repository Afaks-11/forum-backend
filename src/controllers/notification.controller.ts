import type { Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import {
	deleteNotification,
	getAllNotifications,
	getUnreadNotifications,
	markAllNotificationsAsRead,
	markNotificationAsRead,
} from "../services/notification.service.js";
import { notificationIdParamSchema } from "../validators/notification.validator.js";

export const fetchAllNotifications = asyncHandler(
	async (_req: Request, res: Response) => {
		const userId = res.locals.user.userId;
		const list = await getAllNotifications(userId);
		res.status(200).json({ success: true, data: list });
	},
);

export const fetchUnreadNotification = asyncHandler(
	async (_req: Request, res: Response) => {
		const data = await getUnreadNotifications(res.locals.user.userId);
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
