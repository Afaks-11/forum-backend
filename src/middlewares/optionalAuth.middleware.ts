import type { NextFunction, Request, Response } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { env } from "../config/env.config.js";
import { AppError } from "../errors/AppError.js";

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
		return next();
	} catch (_error) {
		return next(new AppError("Session expired or invalid token format", 401));
	}
};
