import type { SystemRole } from "../generated/prisma/enums.js";

/** Platform-wide moderation authority. Community moderators are checked separately. */
export const isAdmin = (role: SystemRole | undefined): boolean =>
	role === "ADMIN";
