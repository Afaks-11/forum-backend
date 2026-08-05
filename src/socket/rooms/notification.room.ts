import { logger } from "../../utils/logger.js";
import type { AuthenticatedSocket } from "../socket.types.js";

/**
 * Subscribes a socket to its owner's private room.
 * The room is keyed by user ID (not socket ID) so a notification reaches every
 * device that user has connected.
 */
export const joinNotificationRoom = (socket: AuthenticatedSocket): void => {
	const userRoom = `user:${socket.data.userId}`;
	socket.join(userRoom);
	logger.info(
		{ socketId: socket.id, room: userRoom },
		`Socket auto-joined private room: ${userRoom}`,
	);
};
