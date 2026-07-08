import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);

export const registerSchema = z
	.object({
		username: z
			.string()
			.min(3, "Username must be at least 3 characters")
			.max(20, "Username cannot exceed 20 characters")
			.regex(
				/^[a-zA-Z0-9_]+$/,
				"Username can only contain alphanumeric characters and underscores",
			),
		email: z.email("Invalid email format"),
		password: z.string().min(8, "Password must be atleast 8 characters long"),
	})
	.openapi("RegisterInput");

export const updateMeSchema = z
	.object({
		username: z
			.string()
			.min(3, "Username must be at 3 characters")
			.max(20, "Username cannot exceed 20 characters"),
	})
	.openapi("UpdateMeInput");

export const loginSchema = z
	.object({
		email: z.email("Invalid email format"),
		password: z.string().min(1, "Password is required"),
	})
	.openapi("LoginInput");

export const changePasswordSchema = z
	.object({
		oldPassword: z.string().min(1, "Old password is required"),
		newPassword: z
			.string()
			.min(8, "New password must be at least 8 characters"),
	})
	.openapi("ChangePasswordInput");

export const forgotPasswordSchema = z
	.object({
		email: z.email("Invalid email format"),
	})
	.openapi("ForgotPasswordInput");

export const resetPasswordSchema = z
	.object({
		token: z.string().min(6, "Reset token is required"),
		newPassword: z
			.string()
			.min(8, "New password must be at least 8 characters"),
	})
	.openapi("ResetPasswordInput");

export const verifyEmailSchema = z
	.object({
		token: z.string().min(1, "Verification token is required"),
	})
	.openapi("VerifyEmailInput");

export const userResponseSchema = z
	.object({
		id: z.uuid().openapi({
			description: "The unique UUID of the user",
			example: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
		}),
		username: z.string().openapi({ example: "johndoe" }),
		email: z.email().openapi({ example: "john@example.com" }),
		isEmailVerified: z.boolean().openapi({ example: true }),
		createdAt: z.date().openapi({ example: "2026-07-07T22:52:55Z" }),
	})
	.openapi("UserResponseData");

export const genericResponseSchema = z
	.object({
		success: z.boolean().openapi({ example: true }),
		message: z.string().openapi({ example: "Operation executed successfully" }),
	})
	.openapi("GenericResponse");

export const profileResponseWrapper = z
	.object({
		success: z.boolean().openapi({ example: true }),
		data: z.object({
			userProfileDetails: userResponseSchema.optional(),
			updatedUserProfileDetails: z
				.object({
					id: z.uuid(),
					username: z.string(),
					email: z.string(),
				})
				.optional(),
		}),
	})
	.openapi("ProfileResponseWrapper");

export const resendTokenSchema = z
	.object({
		email: z.email().openapi({ example: "john@example.com" }),
	})
	.openapi("ResendTokenInput");

export const loginResponseSchema = z
	.object({
		accessToken: z.string(),
		refreshToken: z.string(),
		user: z.object({ id: z.string(), username: z.string() }),
	})
	.openapi("loginResponseData");

export const refreshTokenResponseSchema = z
	.object({
		accessToken: z.string(),
	})
	.openapi("RefreshTokenData");

export type RegisterInput = z.infer<typeof registerSchema>;
export type UpdateMeInput = z.infer<typeof updateMeSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
