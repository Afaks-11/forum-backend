import type { AuthenticatedSocket } from "../socket.types.js";

export const registerPostRoomListeners = (
	socket: AuthenticatedSocket,
): void => {
	// Client transitions onto a post page
	socket.on("post:join", (postId: string) => {
		if (!postId || typeof postId !== "string") return;

		const postRoom = `post:${postId}`;
		socket.join(postRoom);
		console.log(
			`User [${socket.data.userId}] joined live updates for: ${postRoom}`,
		);
	});

	// Client transitions away from a post page
	socket.on("post:leave", (postId: string) => {
		if (!postId || typeof postId !== "string") return;

		const postRoom = `post:${postId}`;
		socket.leave(postRoom);
		console.log(
			`User [${socket.data.userId}] left live updates for: ${postRoom}`,
		);
	});
};
