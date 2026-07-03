import jwt from "jsonwebtoken";
import { env } from "../config/env.config.js";
import { AppError } from "../errors/AppError.js";
import type { AuthenticatedSocket } from "../socket/socket.types.js";

/**
 * Validates the JWT during socket handshakes and binds the user ID to the socket.
 */
export const socketAuthMiddleware = (
	socket: AuthenticatedSocket,
	next: (err?: Error) => void,
): void => {
	const token =
		socket.handshake.auth?.token ||
		socket.handshake.headers.authorization?.split(" ")[1] ||
		socket.handshake.query?.token;

	if (!token || typeof token !== "string") {
		throw new AppError("Authentication error: Token verification failed.", 401);
	}

	try {
		const secret = env.jwt.accessSecret;

		// Decoded signature payload verification
		const decoded = jwt.verify(token, secret) as {
			userId: string;
		};

		if (!decoded.userId) {
			throw new AppError(
				"Authentication error: Token verification failed.",
				401,
			);
		}

		socket.data.userId = decoded.userId;
		next();
	} catch (_err) {
		throw new AppError("Authentication error: Token verification failed.", 401);
	}
};
