import express from "express";
import {
	destroySingleNotification,
	fetchAllNotifications,
	fetchUnreadNotification,
	readAllNotifications,
	readSingleNotification,
} from "../controllers/notification.controller.js";
import { requireAuth } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.use(requireAuth);

router.get("/", requireAuth, fetchAllNotifications);
router.get("/unread", fetchUnreadNotification);
router.patch("/read-all", readAllNotifications);
router.patch("/:id/read", readSingleNotification);
router.delete("/:id", destroySingleNotification);

export default router;
