import type { NextFunction, Request, Response } from "express";
import { logger } from "../utils/logger.js";
import { prisma } from "../utils/prisma.js";

type AllowedRole = "USER" | "MODERATOR" | "ADMIN";

/**
 * Reusable role-based authorization gatekeeper.
 * Assumes requireAuth has already executed and populated res.locals.user.
 */
export const requireRole = (allowedRoles: AllowedRole[]) => {
	return async (
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> => {
		try {
			const userId = res.locals.user?.userId;

			if (!userId) {
				res.status(401).json({
					success: false,
					message: "Authentication context missing.",
				});
				return;
			}

			// Fetch the user's live system role from the database
			const user = await prisma.user.findUnique({
				where: { id: userId },
				select: { role: true },
			});

			if (!user) {
				res.status(404).json({
					success: false,
					message:
						"User account associated with this session could not be found.",
				});
				return;
			}

			// Verify if the user's role matches any of the required permissions
			if (!allowedRoles.includes(user.role as AllowedRole)) {
				logger.warn(
					{ userId, userRole: user.role, requestedRoute: req.originalUrl },
					"Unauthorized access attempt blocked by RBAC middleware",
				);

				res.status(403).json({
					success: false,
					message:
						"Access forbidden: You do not possess the required privileges.",
				});
				return;
			}

			// Cache the role field in locals to prevent redundant downstream database lookups
			res.locals.user.role = user.role;

			next();
		} catch (error) {
			logger.error(
				{ err: error },
				"Critical error executed inside authorization framework",
			);
			res.status(500).json({
				success: false,
				message: "Internal Authorization Failure",
			});
		}
	};
};

export const requireAdmin = requireRole(["ADMIN"]);
export const requireModerator = requireRole(["MODERATOR", "ADMIN"]);
