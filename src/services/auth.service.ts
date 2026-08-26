import crypto from "node:crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { env } from "../config/env.config.js";
import { AppError } from "../errors/AppError.js";
import { SystemRole } from "../generated/prisma/enums.js";
import { emailQueue } from "../queues/email.queue.js";
import {
	tokenBlacklistRepository,
	userRepository,
} from "../repositories/index.js";
import { logger } from "../utils/logger.js";
import type {
	ChangePasswordInput,
	LoginInput,
	RegisterInput,
	ResetPasswordInput,
	UpdateMeInput,
} from "../validators/auth.validator.js";

/**
 * Registers a new account and queues its verification email.
 * The returned user is unverified until the emailed token is redeemed.
 */
export const registerUser = async (data: RegisterInput) => {
	const existingUser = await userRepository.findByEmailOrUsername(
		data.email,
		data.username,
	);
	if (existingUser) {
		throw new AppError("Username or email already taken", 409);
	}

	let assignedRole: SystemRole = SystemRole.USER;

	const adminSecretEnv = env.admin.adminRegistrationSecret;
	if (data.adminSecret && adminSecretEnv) {
		const providedBuffer = Buffer.from(data.adminSecret);
		const envBuffer = Buffer.from(adminSecretEnv);

		if (
			providedBuffer.length === envBuffer.length &&
			crypto.timingSafeEqual(providedBuffer, envBuffer)
		) {
			assignedRole = SystemRole.ADMIN;
		}
	}

	const salt = await bcrypt.genSalt(10);
	const hashedPassword = await bcrypt.hash(data.password, salt);
	const verificationToken = crypto.randomBytes(32).toString("hex");
	const emailVerifyTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

	const newUser = await userRepository.create({
		...data,
		role: assignedRole,
		passwordHash: hashedPassword,
		verificationToken,
		emailVerifyTokenExpires,
	});
	await emailQueue.add(`verify-email:${newUser.id}`, {
		to: newUser.email,
		subject: "Verify Your Forum Account",
		htmlContent: `<h1>Welcome ${newUser.username}!</h1>
     <p>Please confirm your account by using the following secure token: ${verificationToken}</p>`,
	});

	return newUser;
};

/**
 * Authenticates a credential pair and issues an access/refresh token pair.
 * Applies the failed-attempt lockout and rejects unverified or deleted accounts.
 */
export const loginUser = async (data: LoginInput) => {
	const user = await userRepository.findByEmail(data.email);

	// Always run a bcrypt comparison, even for unknown emails. Skipping it would
	// let an attacker distinguish registered from unregistered addresses by
	// response latency alone.
	const DUMMY_HASH =
		"$2b$10$abcdefghijklmnopqrstuvwxyzA1234567890FakeHashForTimingDef";
	const hashToValidate = user ? user.password : DUMMY_HASH;
	const isPasswordValid = await bcrypt.compare(data.password, hashToValidate);

	if (user?.lockUntil && user.lockUntil > new Date()) {
		throw new AppError(
			`Account temporarily locked. Please try again after ${user.lockUntil.toLocaleTimeString()}`,
			423,
		);
	}

	if (!user || !isPasswordValid) {
		if (user) {
			const updatedUser = await userRepository.incrementLoginAttemptsAtomic(
				user.id,
			);

			if (updatedUser.loginAttempts === 5) {
				await emailQueue.add(`login-attempt-failed:${user.id}`, {
					to: user.email,
					subject: "Security Alert: Too many failed login attempts",
					htmlContent: `<p>Your account has been locked for 15 minutes due to 5 consecutive failed login attempts.</p>`,
				});
			}

			if (updatedUser.loginAttempts >= 5) {
				throw new AppError(
					"Account locked due to multiple login failures.",
					423,
				);
			}
		}
		throw new AppError("Invalid email or password credentials", 400);
	}

	if (user.deletedAt) {
		throw new AppError("Invalid email or password credentials", 400);
	}

	if (!user.isEmailVerified) {
		throw new AppError(
			"Please check your inbox and verify your email to log in.",
			403,
		);
	}

	await userRepository.updateLoginLockState(user.id, {
		loginAttempts: 0,
		lockUntil: null,
	});

	const accessToken = jwt.sign({ userId: user.id }, env.jwt.accessSecret, {
		expiresIn: "15m",
	});

	// The password hash is folded into the refresh secret so that changing or
	// resetting a password invalidates every outstanding refresh token for that
	// user without needing a separate revocation record.
	const refreshToken = jwt.sign(
		{ userId: user.id },
		env.jwt.refreshSecret + user.password,
		{
			expiresIn: "7d",
		},
	);

	await emailQueue
		.add(`login-user:${user.id}`, {
			to: user.email,
			subject: "New Login Detected",
			htmlContent: `<p>Hello ${user.username}, a new login was recorded at ${new Date().toISOString()}.</p>`,
		})
		.catch((err) =>
			logger.error({ err }, "Failed to queue login notification"),
		);
	return {
		user: { id: user.id, username: user.username, email: user.email },
		accessToken,
		refreshToken,
	};
};

/**
 * Exchanges a refresh token for a fresh access token.
 * Rejects blacklisted tokens and tokens signed against a since-changed password.
 */
export const refreshAccessToken = async (token: string) => {
	const isBlacklisted = await tokenBlacklistRepository.isBlacklisted(token);
	if (isBlacklisted) {
		throw new AppError("Invalid or expired refresh token", 401);
	}
	try {
		const decoded = jwt.decode(token) as {
			userId: string;
		} | null;

		if (!decoded?.userId) {
			throw new AppError("Invalid or expired refresh token", 401);
		}

		const user = await userRepository.findById(decoded.userId);
		if (!user || user.deletedAt) {
			throw new AppError("User no longer exists", 404);
		}

		jwt.verify(token, env.jwt.refreshSecret + user.password);
		const newAccessToken = jwt.sign({ userId: user.id }, env.jwt.accessSecret, {
			expiresIn: "15m",
		});

		return newAccessToken;
	} catch (error) {
		if (error instanceof AppError) {
			throw error;
		}
		throw new AppError("Invalid or expired refresh token", 401);
	}
};

/**
 * Denylists a refresh token for whatever lifetime it has left.
 * Expired or unparseable tokens are ignored — they are already unusable.
 */
export const blacklistRefreshToken = async (token: string): Promise<void> => {
	try {
		const decoded = jwt.decode(token) as { exp?: number };

		if (typeof decoded?.exp === "number") {
			const timeLeftSeconds = decoded.exp - Math.floor(Date.now() / 1000);

			if (timeLeftSeconds > 0) {
				await tokenBlacklistRepository.blacklist(token, timeLeftSeconds);
			}
		}
	} catch (error) {
		logger.error({ err: error }, "Failed to parse and blacklist token:");
	}
};

export const getUserProfile = async (userId: string) => {
	const user = await userRepository.findProfileById(userId);
	if (!user) throw new AppError("User not found", 404);
	return user;
};

export const updateUserProfile = async (
	data: UpdateMeInput,
	userId: string,
) => {
	if (data.username) {
		const taken = await userRepository.findByUsername(data.username);
		if (taken && taken.id !== userId)
			throw new AppError("Username already taken", 409);
	}
	return await userRepository.updateProfile(userId, data);
};

/**
 * Soft-deletes the account so authored content and audit history survive.
 * Every auth path checks `deletedAt`, which is what makes the row inert.
 */
export const deleteUserAccount = async (userId: string) => {
	return await userRepository.softDelete(userId);
};
/**
 * Rotates a password after re-verifying the caller's current one.
 * Because refresh tokens are signed with the old hash, this invalidates them.
 */
export const changeUserPassword = async (
	data: ChangePasswordInput,
	userId: string,
) => {
	const user = await userRepository.findById(userId);
	if (!user) throw new AppError("User not found", 401);

	const isValid = await bcrypt.compare(data.oldPassword, user.password);
	if (!isValid) throw new AppError("Incorrect current password", 401);

	const salt = await bcrypt.genSalt(10);
	const newHashedPassword = await bcrypt.hash(data.newPassword, salt);
	await userRepository.updatePassword(userId, newHashedPassword);
};

/**
 * Issues a 15-minute password reset token and emails it.
 * Returns silently for unknown or deleted accounts to prevent enumeration.
 */
export const processForgotPassword = async (email: string) => {
	const user = await userRepository.findByEmail(email);
	if (!user || user.deletedAt) return;

	const resetToken = crypto.randomBytes(32).toString("hex");
	const expires = new Date(Date.now() + 15 * 60 * 1000);

	await userRepository.updateResetCredentials(user.id, {
		passwordResetExpires: expires,
		passwordResetToken: resetToken,
	});

	await emailQueue.add(`process-forgotten-password:${user.id}`, {
		to: user.email,
		subject: "<h1>Password Reset Secure Token</h1>",
		htmlContent: `<p>You requested a password reset. Use this token to reset your credentials within 15 minutes:</p>
     <strong>${resetToken}</strong>`,
	});
};

/**
 * Reissues a verification token and its 24-hour expiry together.
 * Both must rotate as a pair, or an account can never be verified again.
 */
export const resendVerificationToken = async (email: string) => {
	const user = await userRepository.findByEmail(email);

	// Do not reveal whether an account exists or is already verified: return
	// silently so the generic controller response can't be used for enumeration.
	if (!user || user.deletedAt || user.isEmailVerified) return;

	const newVerificationToken = crypto.randomBytes(32).toString("hex");
	const newVerificationTokenExpires = new Date(
		Date.now() + 24 * 60 * 60 * 1000,
	);
	await userRepository.updateVerificationToken(
		user.id,
		newVerificationToken,
		newVerificationTokenExpires,
	);

	await emailQueue.add(`resent-verification-token:${user.id}`, {
		to: user.email,
		subject: "Re-sent Verification Token",
		htmlContent: `<p>Here is your new secure token:</p>
     <strong>${newVerificationToken}</strong>`,
	});
};

/**
 * Consumes a reset token, rehashes the new password, and clears the token pair.
 */
export const processResetPassword = async (data: ResetPasswordInput) => {
	const user = await userRepository.findByResetToken(data.token);

	if (!user?.passwordResetExpires || user.passwordResetExpires < new Date()) {
		throw new AppError("Invalid or expired password reset token", 401);
	}

	const salt = await bcrypt.genSalt(10);
	const hashedNewPassword = await bcrypt.hash(data.newPassword, salt);

	await userRepository.resetPasswordAndClearTokens(user.id, hashedNewPassword);
};

/**
 * Redeems an email verification token, rejecting unknown or expired ones.
 */
export const verifyUserEmail = async (token: string) => {
	const user = await userRepository.findByVerifyToken(token);
	if (!user) throw new AppError("Invalid or expired verification token", 401);
	if (
		!user.emailVerifyTokenExpires ||
		user.emailVerifyTokenExpires < new Date()
	) {
		throw new AppError("Verification token has expired", 401);
	}
	await userRepository.verifyEmailStatus(user.id);
};
