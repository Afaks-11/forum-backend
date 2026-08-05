import { logger } from "../../utils/logger.js";
import type { AuthenticatedSocket } from "../socket.types.js";

/**
 * Lets a client opt into and out of live updates for a specific post.
 * Membership is client-driven because a user may have any number of post pages
 * open, and broadcasting every post to every socket would not scale.
 */
export const registerPostRoomListeners = (
	socket: AuthenticatedSocket,
): void => {
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
