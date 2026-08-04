import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.config.js";
import { logger } from "../utils/logger.js";

/**
 * Constant-time string comparison to avoid leaking credential length/content
 * through timing side channels.
 */
const safeCompare = (a: string, b: string): boolean => {
	const bufA = Buffer.from(a);
	const bufB = Buffer.from(b);
	if (bufA.length !== bufB.length) {
		return false;
	}
	return timingSafeEqual(bufA, bufB);
};

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

		const expectedUser = env.bullBoard.username;
		const expectedPass = env.bullBoard.password;

		if (
			username &&
			password &&
			safeCompare(username, expectedUser) &&
			safeCompare(password, expectedPass)
		) {
			return next();
		}
	} catch (err) {
		logger.error({ err }, "Queue Auth decoding error:");
	}

	res.setHeader("WWW-Authenticate", 'Basic realm="Queue Dashboard"');
	return res.status(401).send("Invalid credentials.");
};
