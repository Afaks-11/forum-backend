import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { env } from "../config/env.config.js";
import { socketAuthMiddleware } from "../middlewares/socket.middleware.js";
import { logger } from "../utils/logger.js";
import { joinNotificationRoom } from "./rooms/notification.room.js";
import { registerPostRoomListeners } from "./rooms/post.room.js";
import type { AuthenticatedSocket } from "./socket.types.js";

let io: Server | null = null;

/**
 * Hooks the Socket.IO server directly onto the existing Express HTTP instance.
 */
export const initSocketServer = (httpServer: HttpServer): Server => {
	io = new Server(httpServer, {
		cors: {
			origin: env.app.corsOrigins,
			methods: ["GET", "POST"],
			credentials: true,
		},
	});

	io.use(socketAuthMiddleware);

	// Room membership is established once per connection rather than per event,
	// so a client never has to ask to be subscribed to its own notifications.
	io.on("connection", (socket) => {
		const authSocket = socket as AuthenticatedSocket;
		const userId = authSocket.data.userId;

		joinNotificationRoom(authSocket);
		registerPostRoomListeners(authSocket);
		logger.info(
			{ socketId: socket.id, userId },
			`Real-time client established connection: User [${userId}]`,
		);

		authSocket.on("disconnect", () => {
			logger.info(
				{ socketId: socket.id, userId },
				` Client disconnected: User [${userId}]`,
			);
		});
	});

	return io;
};

/**
 * Returns the running Socket.IO server.
 * Throws instead of returning null so callers that emit before bootstrap fail
 * loudly rather than dropping events silently.
 */
export const getIO = (): Server => {
	if (!io) {
		throw new Error(
			"Critical: Socket.IO Server has not been bootstrapped yet.",
		);
	}
	return io;
};
