import { AppError } from "../errors/AppError.js";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import {
	blacklistRefreshToken,
	changeUserPassword,
	deleteUserAccount,
	getUserProfile,
	loginUser,
	processForgotPassword,
	processResetPassword,
	refreshAccessToken,
	registerUser,
	resendVerificationToken,
	updateUserProfile,
	verifyUserEmail,
} from "../services/auth.service.js";
import { logger } from "../utils/logger.js";
import {
	changePasswordSchema,
	forgotPasswordSchema,
	loginSchema,
	registerSchema,
	resendTokenSchema,
	resetPasswordSchema,
	updateMeSchema,
	verifyEmailSchema,
} from "../validators/auth.validator.js";

export const register = asyncHandler(async (req, res) => {
	const validatedData = registerSchema.parse(req.body);

	const newUser = await registerUser(validatedData);
	res.status(201).json({
		success: true,
		data: newUser,
	});
});

export const login = asyncHandler(async (req, res) => {
	const validatedData = loginSchema.parse(req.body);
	const result = await loginUser(validatedData);

	res.cookie("refreshToken", result.refreshToken, {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "strict",
		maxAge: 7 * 24 * 60 * 60 * 1000,
	});

	res.status(200).json({
		success: true,
		data: {
			user: result.user,
			accessToken: result.accessToken,
		},
	});
});

export const refresh = asyncHandler(async (req, res) => {
	const refreshToken = req.cookies?.refreshToken;
	if (!refreshToken) {
		throw new AppError("No refresh token provided", 401);
	}
	try {
		const newAccessToken = await refreshAccessToken(refreshToken);
		res
			.status(200)
			.json({ success: true, data: { accessToken: newAccessToken } });
	} catch (error) {
		if (
			error instanceof AppError &&
			(error.statusCode === 401 || error.statusCode === 403)
		) {
			res.clearCookie("refreshToken");
		}
		throw error;
	}
});

export const logout = asyncHandler(async (req, res) => {
	const token = req.cookies?.refreshToken;
	if (token) {
		await blacklistRefreshToken(token).catch((err) =>
			logger.error({ err }, "Failed to blacklist refresh token on logout", err),
		);
	}

	res.clearCookie("refreshToken", {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "strict",
	});

	res.status(200).json({
		success: true,
		message: "Logged out successfully",
	});
});

export const getUserDetails = asyncHandler(async (_req, res) => {
	const userId = res.locals.user.userId;

	const userProfileDetails = await getUserProfile(userId);
	res.status(200).json({
		success: true,
		data: {
			userProfileDetails,
		},
	});
});

export const updateUserDetails = asyncHandler(async (req, res) => {
	const userId = res.locals.user.userId;
	const validatedData = updateMeSchema.parse(req.body);

	const updatedUserProfileDetails = await updateUserProfile(
		validatedData,
		userId,
	);

	res.status(201).json({
		success: true,
		data: {
			updatedUserProfileDetails,
		},
	});
});

export const deleteUser = asyncHandler(async (_req, res) => {
	const userId = res.locals.user.userId;
	await deleteUserAccount(userId);
	res.status(204).end();
});

export const updateUserPassword = asyncHandler(async (req, res) => {
	const userId = res.locals.user.userId;
	const validatedData = changePasswordSchema.parse(req.body);

	await changeUserPassword(validatedData, userId);
	res.status(201).json({
		success: true,
		message: "Password updated successfully",
	});
});

export const forgotPassword = asyncHandler(async (req, res) => {
	const { email } = forgotPasswordSchema.parse(req.body);
	await processForgotPassword(email);
	res.status(200).json({
		success: true,
		message: "Reset Password Token has been sent to your email",
	});
});

export const resendToken = asyncHandler(async (req, res) => {
	const { email } = resendTokenSchema.parse(req.body);
	await resendVerificationToken(email);
	res.status(200).json({
		success: true,
		message: "If the account exists, a new verification token has been sent.",
	});
});

export const resetPassword = asyncHandler(async (req, res) => {
	const validatedData = resetPasswordSchema.parse(req.body);
	await processResetPassword(validatedData);
	res.status(200).json({
		success: true,
		message: "Password has been successfully reset",
	});
});

export const verifyEmail = asyncHandler(async (req, res) => {
	const { token } = verifyEmailSchema.parse(req.body);
	await verifyUserEmail(token);
	res.status(200).json({
		success: true,
		message: "Account successfully verified",
	});
});
