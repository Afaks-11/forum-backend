import type { PrismaClient } from "../generated/prisma/client.js";
import type {
	RegisterInput,
	UpdateMeInput,
} from "../validators/auth.validator.js";

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
		data: RegisterInput & { passwordHash: string; verificationToken: string },
	) {
		return await this.prisma.user.create({
			data: {
				username: data.username,
				email: data.email,
				password: data.passwordHash,
				emailVerifyToken: data.verificationToken,
			},
			select: {
				id: true,
				username: true,
				email: true,
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
	 * Hard-delete a user profile from the database
	 */
	async delete(id: string) {
		return await this.prisma.user.delete({
			where: { id },
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
	 * Reset password and clear transient reset credentials in a single operation
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
	 * Update or cycle a user's verification token
	 */
	async updateVerificationToken(id: string, emailVerifyToken: string | null) {
		return await this.prisma.user.update({
			where: { id },
			data: { emailVerifyToken },
		});
	}

	/**
	 * Mark email status as verified and clear verification token
	 */
	async verifyEmailStatus(id: string) {
		return await this.prisma.user.update({
			where: { id },
			data: { isEmailVerified: true, emailVerifyToken: null },
		});
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
	 * Check if a block relation exists in either direction
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
	async findPostsByAuthorId(authorId: string) {
		return await this.prisma.post.findMany({
			where: { authorId },
			orderBy: { createdAt: "desc" },
		});
	}

	/**
	 * Retrieve all comments published by a user
	 */
	async findCommentsByAuthorId(authorId: string) {
		return await this.prisma.comment.findMany({
			where: { authorId },
			orderBy: { createdAt: "desc" },
		});
	}

	/**
	 * Create or ignore follow state safely
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
	 * Remove explicit follow target relation
	 */
	async deleteFollowRelation(followerId: string, followingId: string) {
		return await this.prisma.follow.deleteMany({
			where: { followerId, followingId },
		});
	}

	/**
	 * Remove follow links between both users (used during a block event)
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
	 * Create block state safety record
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
	 * Executes a lightning-fast lightweight partial matching search for user autocompletes.
	 */
	async searchUsers(query: string, limit: number) {
		return await this.prisma.user.findMany({
			where: {
				username: {
					contains: query,
					mode: "insensitive",
				},
			},
			take: limit,
			select: {
				username: true,
				avatar: true,
				displayName: true,
			},
		});
	}
}
