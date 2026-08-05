import type { NextFunction, Request, Response } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { env } from "../config/env.config.js";

/**
 * Attaches the caller's identity when a valid token is present, but never
 * rejects. Used by endpoints whose response is richer for signed-in users yet
 * must stay reachable anonymously.
 */
export const optionalAuth = (
	req: Request,
	res: Response,
	next: NextFunction,
) => {
	const authHeader = req.headers.authorization;

	if (!authHeader?.startsWith("Bearer ")) {
		return next();
	}

	const token = authHeader.split(" ")[1];
	if (!token) {
		return next();
	}
	try {
		const decoded = jwt.verify(token, env.jwt.accessSecret) as JwtPayload & {
			userId: string;
		};

		res.locals.user = {
			userId: decoded.userId,
		};
	} catch (_error) {
		// Optional auth: an invalid or expired token simply means the request
		// proceeds anonymously rather than failing the whole request.
	}
	return next();
};
