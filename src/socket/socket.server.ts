import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { socketAuthMiddleware } from "../middlewares/socket.middleware.js";
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
			origin: "*",
			methods: ["GET", "POST"],
		},
	});

	io.use(socketAuthMiddleware);

	// Default room configuration trigger
	io.on("connection", (socket) => {
		const authSocket = socket as AuthenticatedSocket;
		const userId = authSocket.data.userId;

		joinNotificationRoom(authSocket);
		registerPostRoomListeners(authSocket);
		console.log(`Real-time client established connection: User [${userId}]`);

		authSocket.on("disconnect", () => {
			console.log(` Client disconnected: User [${userId}]`);
		});
	});

	return io;
};

/**
 * Safely fetches the active Socket.IO server engine from anywhere in the codebase.
 */
export const getIO = (): Server => {
	if (!io) {
		throw new Error(
			"Critical: Socket.IO Server has not been bootstrapped yet.",
		);
	}
	return io;
};
