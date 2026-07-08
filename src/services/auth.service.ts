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

	const hashedPassword = await bcrypt.hash(data.password, 10);
	const verificationToken = crypto.randomBytes(32).toString("hex");

	const newUser = await userRepository.create({
		...data,
		passwordHash: hashedPassword,
		verificationToken,
	});
	await emailQueue.add(`verify-amil:${newUser.id}`, {
		to: newUser.email,
		subject: "Verify Your Forum Account",
		htmlContent: `<h1>Welcome ${newUser.username}!</h1>
     <p>Please confirm your account by using the following secure token:</p>
     <code style="background:#f4f4f4; padding:5px 10px; display:inline-block;">${verificationToken}</code>`,
	});

	return newUser;
};

export const loginUser = async (data: LoginInput) => {
	const user = await userRepository.findByEmail(data.email);
	if (!user) {
		throw new AppError("Invalid email or password credentials", 400);
	}

	if (user.lockUntil && user.lockUntil > new Date()) {
		throw new AppError(
			`Account temporarily locked. Please try again after ${user.lockUntil.toLocaleTimeString()}`,
			423,
		);
	}

	const isPasswordValid = await bcrypt.compare(data.password, user.password);
	if (!isPasswordValid) {
		const updatedAttempts = user.loginAttempts + 1;
		let lockUntilTime: Date | null = null;

		if (updatedAttempts >= 5) {
			lockUntilTime = new Date(Date.now() + 15 * 60 * 1000);

			await emailQueue.add(`login-attemt-failed:${user.id}`, {
				to: user.email,
				subject: "Security Alert: Too many failed login attempts",
				htmlContent: `<p>Your account has been locked for 15 minutes due to 5 consecutive failed login attempts.</p>`,
			});

			throw new AppError("Account locked due to multiple login failures.", 423);
		}

		await userRepository.updateLoginLockState(user.id, {
			loginAttempts: updatedAttempts,
			lockUntil: lockUntilTime,
		});

		throw new AppError("Invalid email or password credentials", 401);
	}

	if (!user.isEmailVerified) {
		throw new AppError(
			"Please check your inbox and verify your email to log in. ",
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

	const refreshToken = jwt.sign({ userId: user.id }, env.jwt.refreshSecret, {
		expiresIn: "7d",
	});

	await emailQueue.add(`login-user:${user.id}`, {
		to: user.email,
		subject: "New Login Detected",
		htmlContent: `<p>Hello ${user.username}, a new login was just recorded for your profile at ${new Date().toLocaleString()}.</p>`,
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
		const decoded = jwt.verify(token, env.jwt.refreshSecret) as {
			userId: string;
		};

		const user = await userRepository.findById(decoded.userId);

		if (!user) {
			throw new AppError("User no longer exists", 404);
		}

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
		console.error("Failed to parse and blacklist token:", error);
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
		if (taken && taken.id !== userId) throw new Error("Username already taken");
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

	const newHashedPassword = await bcrypt.hash(data.newPassword, 10);
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

	const hashedNewPassword = await bcrypt.hash(data.newPassword, 10);
	await userRepository.resetPasswordAndClearTokens(user.id, hashedNewPassword);
};

export const verifyUserEmail = async (token: string) => {
	const user = await userRepository.findByVerifyToken(token);
	if (!user) throw new AppError("Invalid or expired verification token", 401);
	await userRepository.verifyEmailStatus(user.id);
};
