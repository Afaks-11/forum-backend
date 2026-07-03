import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.config.js";

/**
 * Lightweight, dependency-free HTTP Basic Authentication middleware
 * to protect the background job control room.
 */
export const queueAuthMiddleware = (
	req: Request,
	res: Response,
	next: NextFunction,
) => {
	const authHeader = req.headers.authorization;

	if (!authHeader) {
		res.setHeader("WWW-Authenticate", 'Basic realm="Queue Dashboard"');
		return res.status(401).send("Authentication required.");
	}

	try {
		// Decode the Base64 header "Basic <token>"
		const [scheme, credentials] = authHeader.split(" ");
		if (scheme !== "Basic" || !credentials) {
			return res.status(401).send("Invalid authorization header scheme.");
		}

		const [username, password] = Buffer.from(credentials, "base64")
			.toString("utf-8")
			.split(":");

		// Fallback to safe defaults if environment variables aren't defined yet
		const expectedUser = env.bullBoard.username || "admin";
		const expectedPass = env.bullBoard.password || "admin_secret_pass";

		if (username === expectedUser && password === expectedPass) {
			return next();
		}
	} catch (err) {
		console.error("Queue Auth decoding error:", err);
	}

	res.setHeader("WWW-Authenticate", 'Basic realm="Queue Dashboard"');
	return res.status(401).send("Invalid credentials.");
};
