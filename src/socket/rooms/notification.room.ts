import type { AuthenticatedSocket } from "../socket.types.js";

export const joinNotificationRoom = (socket: AuthenticatedSocket): void => {
	const userRoom = `user:${socket.data.userId}`;
	socket.join(userRoom);
	console.log(`Socket [${socket.id}] auto-joined private room: ${userRoom}`);
};
