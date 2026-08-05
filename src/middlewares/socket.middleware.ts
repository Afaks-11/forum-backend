import jwt from "jsonwebtoken";
import { env } from "../config/env.config.js";
import { AppError } from "../errors/AppError.js";
import type { AuthenticatedSocket } from "../socket/socket.types.js";

/**
 * Validates the JWT during socket handshakes and binds the user ID to the socket.
 * Three token locations are accepted because browser WebSocket clients cannot
 * set request headers; native and proxied clients can.
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
		next(new AppError("Authentication error: Token verification failed.", 401));
		return;
	}

	try {
		const secret = env.jwt.accessSecret;

		// Every failure path returns the same opaque message so a caller cannot
		// distinguish an expired token from a forged or malformed one.
		const decoded = jwt.verify(token, secret) as {
			userId: string;
		};

		if (!decoded.userId) {
			next(
				new AppError("Authentication error: Token verification failed.", 401),
			);
			return;
		}

		socket.data.userId = decoded.userId;
		next();
	} catch (_err) {
		next(new AppError("Authentication error: Token verification failed.", 401));
	}
};
