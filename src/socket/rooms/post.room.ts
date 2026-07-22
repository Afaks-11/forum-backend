import { logger } from "../../utils/logger.js";
import type { AuthenticatedSocket } from "../socket.types.js";

export const registerPostRoomListeners = (
	socket: AuthenticatedSocket,
): void => {
	// Client transitions onto a post page
	socket.on("post:join", (postId: string) => {
		if (!postId || typeof postId !== "string") return;

		const postRoom = `post:${postId}`;
		socket.join(postRoom);
		logger.debug(
			{ userId: socket.data.userId, room: postRoom },
			`User joined live updates room`,
		);
	});

	// Client transitions away from a post page
	socket.on("post:leave", (postId: string) => {
		if (!postId || typeof postId !== "string") return;

		const postRoom = `post:${postId}`;
		socket.leave(postRoom);
		logger.debug(
			{ userId: socket.data.userId, room: postRoom },
			`User left live updates room`,
		);
	});
};
