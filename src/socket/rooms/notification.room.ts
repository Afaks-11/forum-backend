import { logger } from "../../utils/logger.js";
import type { AuthenticatedSocket } from "../socket.types.js";

export const joinNotificationRoom = (socket: AuthenticatedSocket): void => {
	const userRoom = `user:${socket.data.userId}`;
	socket.join(userRoom);
	logger.info(
		{ socketId: socket.id, room: userRoom },
		`Socket auto-joined private room: ${userRoom}`,
	);
};
