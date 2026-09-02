import {
	Prisma,
	type PrismaClient,
	type SystemRole,
} from "../generated/prisma/client.js";
import type {
	RegisterInput,
	UpdateMeInput,
} from "../validators/auth.validator.js";
import { postListInclude } from "./post.repository.js";

export class UserRepository {
	constructor(private readonly prisma: PrismaClient) {}

	/**
	 * Look up a user profile by email or username (used during signup checks)
	 */
	async findByEmailOrUsername(email: string, username: string) {
		return await this.prisma.user.findFirst({
			where: {
				OR: [{ email }, { username }],
			},
		});
	}

	/**
	 * Register a new user with specific select fields returned
	 */
	async create(
		data: RegisterInput & {
			role: SystemRole;
			passwordHash: string;
			verificationToken: string;
			emailVerifyTokenExpires: Date;
		},
	) {
		return await this.prisma.user.create({
			data: {
				username: data.username,
				email: data.email,
				password: data.passwordHash,
				role: data.role,
				emailVerifyToken: data.verificationToken,
				emailVerifyTokenExpires: data.emailVerifyTokenExpires,
			},
			select: {
				id: true,
				username: true,
				email: true,
				role: true,
				createdAt: true,
			},
		});
	}

	/**
	 * Find user by unique email address
	 */
	async findByEmail(email: string) {
		return await this.prisma.user.findUnique({
			where: { email },
		});
	}

	/**
	 * Find user by unique username
	 */
	async findByUsername(username: string) {
		return await this.prisma.user.findUnique({
			where: { username },
		});
	}

	/**
	 * Find user by primary database ID
	 */
	async findById(id: string) {
		return await this.prisma.user.findUnique({
			where: { id },
		});
	}

	/**
	 * Find user profile for public resource display
	 */
	async findProfileById(id: string) {
		return await this.prisma.user.findUnique({
			where: { id },
			select: {
				id: true,
				username: true,
				email: true,
				role: true,
				isEmailVerified: true,
				createdAt: true,
			},
		});
	}

	/**
	 * Search for active verification token
	 */
	async findByVerifyToken(emailVerifyToken: string) {
		return await this.prisma.user.findUnique({
			where: { emailVerifyToken },
		});
	}

	/**
	 * Search for active password reset token
	 */
	async findByResetToken(passwordResetToken: string) {
		return await this.prisma.user.findUnique({
			where: { passwordResetToken },
		});
	}

	/**
	 * Update dynamic login block properties (attempts/locking windows)
	 */
	async updateLoginLockState(
		id: string,
		data: { loginAttempts: number; lockUntil: Date | null },
	) {
		return await this.prisma.user.update({
			where: { id },
			data,
		});
	}

	/**
	 * Update profile details (username, email, etc.)
	 */
	async updateProfile(id: string, data: UpdateMeInput) {
		return await this.prisma.user.update({
			where: { id },
			data,
			select: { id: true, username: true, email: true },
		});
	}

	/**
	 * Soft-delete a user profile by stamping deletedAt.
	 * A hard delete would violate foreign keys because posts, comments, votes,
	 * memberships and owned communities reference the user without cascade rules.
	 */
	async softDelete(id: string) {
		return await this.prisma.user.update({
			where: { id },
			data: { deletedAt: new Date() },
		});
	}

	/**
	 * Update user password hash directly
	 */
	async updatePassword(id: string, passwordHash: string) {
		return await this.prisma.user.update({
			where: { id },
			data: { password: passwordHash },
		});
	}

	/**
	 * Update password reset credentials
	 */
	async updateResetCredentials(
		id: string,
		data: {
			passwordResetToken: string | null;
			passwordResetExpires: Date | null;
		},
	) {
		return await this.prisma.user.update({
			where: { id },
			data,
		});
	}

	/**
	 * Clears the password and both reset fields in one write, so a reset token
	 * cannot be replayed against the new password.
	 */
	async resetPasswordAndClearTokens(id: string, passwordHash: string) {
		return await this.prisma.user.update({
			where: { id },
			data: {
				password: passwordHash,
				passwordResetToken: null,
				passwordResetExpires: null,
			},
		});
	}

	/**
	 * Update or cycle a user's verification token.
	 *
	 * The expiry is rotated with the token, never independently: issuing a fresh
	 * token while leaving a lapsed `emailVerifyTokenExpires` in place would make
	 * the new token dead on arrival and lock the account out of verification.
	 */
	async updateVerificationToken(
		id: string,
		emailVerifyToken: string,
		emailVerifyTokenExpires: Date,
	) {
		return await this.prisma.user.update({
			where: { id },
			data: { emailVerifyToken, emailVerifyTokenExpires },
		});
	}

	/**
	 * Mark email status as verified and clear verification token
	 */
	async verifyEmailByToken(token: string) {
		const result = await this.prisma.user.updateMany({
			where: {
				emailVerifyToken: token,
				emailVerifyTokenExpires: {
					gt: new Date(),
				},
			},
			data: {
				isEmailVerified: true,
				emailVerifyToken: null,
				emailVerifyTokenExpires: null,
			},
		});

		return result.count > 0;
	}

	/**
	 * Fetch user profile with aggregated counters
	 */
	async findProfileWithCounters(userId: string) {
		return await this.prisma.user.findUnique({
			where: { id: userId },
			select: {
				id: true,
				username: true,
				createdAt: true,
				_count: {
					select: {
						posts: true,
						comments: true,
						followers: true,
						following: true,
					},
				},
			},
		});
	}

	/**
	 * Checks for a block in either direction — a block hides the profile from
	 * both parties, so the caller does not need to know who blocked whom.
	 */
	async checkBlockRelation(userA: string, userB: string) {
		return await this.prisma.block.findFirst({
			where: {
				OR: [
					{ blockerId: userA, blockedId: userB },
					{ blockerId: userB, blockedId: userA },
				],
			},
		});
	}

	/**
	 * Check if follower relationship exists
	 */
	async checkFollowRelation(followerId: string, followingId: string) {
		return await this.prisma.follow.findUnique({
			where: {
				followerId_followingId: { followerId, followingId },
			},
		});
	}

	/**
	 * Retrieve all posts published by a user
	 */
	async findPostsByAuthorId(authorId: string, limit = 50) {
		return await this.prisma.post.findMany({
			where: { authorId, deletedAt: null },
			take: limit,
			include: postListInclude,
			orderBy: [{ createdAt: "desc" }, { id: "desc" }],
		});
	}

	/**
	 * Retrieve all comments published by a user
	 */
	async findCommentsByAuthorId(authorId: string, limit = 50) {
		return await this.prisma.comment.findMany({
			where: { authorId, deletedAt: null },
			take: limit,
			orderBy: [{ createdAt: "desc" }, { id: "desc" }],
		});
	}

	/**
	 * Creates a follow idempotently: an upsert with an empty update keeps a
	 * repeated follow from raising a unique constraint error.
	 */
	async createFollowRelation(followerId: string, followingId: string) {
		return await this.prisma.follow.upsert({
			where: {
				followerId_followingId: { followerId, followingId },
			},
			update: {},
			create: { followerId, followingId },
		});
	}

	/**
	 * Removes a follow. Uses `deleteMany` so unfollowing when no relation exists
	 * resolves quietly instead of throwing a record-not-found error.
	 */
	async deleteFollowRelation(followerId: string, followingId: string) {
		return await this.prisma.follow.deleteMany({
			where: { followerId, followingId },
		});
	}

	/**
	 * Severs follows in both directions, called when a block is placed so the
	 * blocked user cannot keep receiving the blocker's activity through an
	 * existing follow.
	 */
	async deleteMutualFollows(userA: string, userB: string) {
		return await this.prisma.follow.deleteMany({
			where: {
				OR: [
					{ followerId: userA, followingId: userB },
					{ followerId: userB, followingId: userA },
				],
			},
		});
	}

	/**
	 * Creates a block idempotently, so re-blocking an already-blocked user is
	 * a no-op rather than a constraint violation.
	 */
	async createBlockRelation(blockerId: string, blockedId: string) {
		return await this.prisma.block.upsert({
			where: {
				blockerId_blockedId: { blockerId, blockedId },
			},
			update: {},
			create: { blockerId, blockedId },
		});
	}

	/**
	 * Remove block restriction
	 */
	async deleteBlockRelation(blockerId: string, blockedId: string) {
		return await this.prisma.block.deleteMany({
			where: { blockerId, blockedId },
		});
	}

	/**
	 * Case-insensitive substring match on username, for autocomplete.
	 *
	 * Relation counts rather than full relation rows: the previous form selected
	 * every post, follow, and community per match, which grew the payload
	 * without bound on active accounts.
	 */
	async searchUsers(query: string, limit: number) {
		return await this.prisma.user.findMany({
			where: {
				username: {
					contains: query,
					mode: "insensitive",
				},
				deletedAt: null,
			},
			take: limit,
			select: {
				id: true,
				username: true,
				_count: {
					select: {
						following: true,
						followers: true,
						posts: true,
						ownedCommunities: true,
					},
				},
			},
		});
	}

	/**
	 * Increments the failed login counter and applies a 15-minute lock on the
	 * fifth failure, both inside one transaction so a concurrent login cannot
	 * race past the threshold and bypass the lock.
	 */
	async incrementLoginAttemptsAtomic(userId: string) {
		const rows = await this.prisma.$queryRaw<
			{ loginAttempts: number; lockUntil: Date | null }[]
		>(Prisma.sql`
			UPDATE users
			SET login_attempts = login_attempts + 1,
				lock_until = CASE
					WHEN login_attempts + 1 >= 5
					THEN NOW() + INTERVAL '15 minutes'
					ELSE lock_until
				END,
				updated_at = NOW()
			WHERE id = ${userId}
			RETURNING login_attempts AS "loginAttempts", lock_until AS "lockUntil"
		`);

		const user = rows[0];
		if (!user) throw new Error("User profile target missing.");
		return user;
	}

	async findSavedPosts(userId: string, limit: number, cursor?: string) {
		const rows = await this.prisma.savedPost.findMany({
			where: { userId, post: { deletedAt: null } },
			take: limit + 1,
			...(cursor
				? { cursor: { userId_postId: { userId, postId: cursor } }, skip: 1 }
				: {}),
			include: { post: { include: postListInclude } },
			orderBy: [{ createdAt: "desc" }, { postId: "desc" }],
		});
		const hasNextPage = rows.length > limit;
		if (hasNextPage) rows.pop();
		const last = rows[rows.length - 1];
		return {
			items: rows.map((row) => row.post),
			nextCursor: hasNextPage && last ? last.postId : null,
		};
	}

	async findSavedComments(userId: string, limit: number, cursor?: string) {
		const rows = await this.prisma.savedComment.findMany({
			where: { userId, comment: { deletedAt: null } },
			take: limit + 1,
			...(cursor
				? {
						cursor: { userId_commentId: { userId, commentId: cursor } },
						skip: 1,
					}
				: {}),
			include: {
				comment: {
					include: { author: { select: { id: true, username: true } } },
				},
			},
			orderBy: [{ createdAt: "desc" }, { commentId: "desc" }],
		});
		const hasNextPage = rows.length > limit;
		if (hasNextPage) rows.pop();
		const last = rows[rows.length - 1];
		return {
			items: rows.map((row) => row.comment),
			nextCursor: hasNextPage && last ? last.commentId : null,
		};
	}
}
