import crypto from "node:crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { env } from "../config/env.config.js";
import { AppError } from "../errors/AppError.js";
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

export const registerUser = async (data: RegisterInput) => {
	const existingUser = await userRepository.findByEmailOrUsername(
		data.email,
		data.username,
	);
	if (existingUser) {
		throw new AppError("Username or email already taken", 409);
	}

	const salt = await bcrypt.genSalt(10);
	const hashedPassword = await bcrypt.hash(data.password, salt);
	const verificationToken = crypto.randomBytes(32).toString("hex");

	const newUser = await userRepository.create({
		...data,
		passwordHash: hashedPassword,
		verificationToken,
	});
	await emailQueue.add(`verify-email:${newUser.id}`, {
		to: newUser.email,
		subject: "Verify Your Forum Account",
		htmlContent: `<h1>Welcome ${newUser.username}!</h1>
     <p>Please confirm your account by using the following secure token: ${verificationToken}</p>`,
	});

	return newUser;
};

export const loginUser = async (data: LoginInput) => {
	const user = await userRepository.findByEmail(data.email);

	// FIXED: Mitigate User Enumeration via Timing Attacks
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
			// The atomic execution wrapper applies thresholding and sets the lock window safely.
			const updatedUser = await userRepository.incrementLoginAttemptsAtomic(
				user.id,
			);

			if (updatedUser.loginAttempts === 5) {
				// Ensure the security notification fires exactly ONCE when crossing the limit
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

	if (!user.isEmailVerified) {
		throw new AppError(
			"Please check your inbox and verify your email to log in.",
			403,
		);
	}

	// Clear dynamic lockout rate limits on success path
	await userRepository.updateLoginLockState(user.id, {
		loginAttempts: 0,
		lockUntil: null,
	});

	const accessToken = jwt.sign({ userId: user.id }, env.jwt.accessSecret, {
		expiresIn: "15m",
	});

	const refreshToken = jwt.sign(
		{ userId: user.id },
		env.jwt.refreshSecret + user.password,
		{
			expiresIn: "7d",
		},
	);

	await emailQueue.add(`login-user:${user.id}`, {
		to: user.email,
		subject: "New Login Detected",
		htmlContent: `<p>Hello ${user.username}, a new login was just recorded for your profile at ${new Date().toISOString()}.</p>`,
	});

	return {
		user: { id: user.id, username: user.username, email: user.email },
		accessToken,
		refreshToken,
	};
};

export const refreshAccessToken = async (token: string) => {
	const isBlacklisted = await tokenBlacklistRepository.isBlacklisted(token);
	if (isBlacklisted) {
		throw new AppError("Invalid or expired refresh token", 401);
	}
	try {
		const payload = jwt.verify(token, env.jwt.refreshSecret) as {
			userId: string;
		};

		const user = await userRepository.findById(payload.userId);
		if (!user) {
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

export const deleteUserAccount = async (userId: string) => {
	return await userRepository.delete(userId);
};
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

export const processForgotPassword = async (email: string) => {
	const user = await userRepository.findByEmail(email);
	if (!user) return;

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

export const resendVerificationToken = async (email: string) => {
	const user = await userRepository.findByEmail(email);
	if (!user) throw new AppError("User not found", 404);
	if (user.isEmailVerified)
		throw new AppError("Account is already verified", 409);

	const newVerificationToken = crypto.randomBytes(32).toString("hex");
	await userRepository.updateVerificationToken(user.id, newVerificationToken);

	await emailQueue.add(`resent-verification-token:${user.id}`, {
		to: user.email,
		subject: "Re-sent Verification Token",
		htmlContent: `<p>Here is your new secure token:</p>
     <strong>${newVerificationToken}</strong>`,
	});
};

export const processResetPassword = async (data: ResetPasswordInput) => {
	const user = await userRepository.findByResetToken(data.token);

	if (!user?.passwordResetExpires || user.passwordResetExpires < new Date()) {
		throw new AppError("Invalid or expired password reset token", 401);
	}

	const salt = await bcrypt.genSalt(10);
	const hashedNewPassword = await bcrypt.hash(data.newPassword, salt);

	await userRepository.resetPasswordAndClearTokens(user.id, hashedNewPassword);
};

export const verifyUserEmail = async (token: string) => {
	const user = await userRepository.findByVerifyToken(token);
	if (!user) throw new AppError("Invalid or expired verification token", 401);
	await userRepository.verifyEmailStatus(user.id);
};
