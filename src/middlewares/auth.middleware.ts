import type { NextFunction, Request, Response } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { env } from "../config/env.config.js";

export const requireAuth = (
	req: Request,
	res: Response,
	next: NextFunction,
): void => {
	try {
		const authHeader = req.headers.authorization;
		if (!authHeader?.startsWith("Bearer ")) {
			res.status(401).json({
				success: false,
				message: "Missing or invalid authorization header",
			});
			return;
		}

		const token = authHeader.split(" ")[1];

		if (!token) {
			res
				.status(401)
				.json({ success: false, message: "Access token is missing" });
			return;
		}

		const decoded = jwt.verify(token, env.jwt.accessSecret) as JwtPayload & {
			userId: string;
		};

		res.locals.user = {
			userId: decoded.userId,
		};

		next();
	} catch (_error) {
		res.status(401).json({
			success: false,
			message: "Invalid or expired access token",
		});
	}
};
