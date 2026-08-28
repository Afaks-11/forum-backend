import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

// Mutates the shared Zod instance to add `.openapi()`. Every validator module
// calls it because import order across the registry is not guaranteed, and the
// extension is idempotent.
extendZodWithOpenApi(z);

export const usernameSchema = z
	.string()
	.min(3, "Username must be at least 3 characters")
	.max(20, "Username cannot exceed 20 characters")
	.regex(
		/^[a-zA-Z0-9_]+$/,
		"Username can only contain alphanumeric characters and underscores",
	);

export const registerSchema = z
	.object({
		username: usernameSchema,
		email: z.email("Invalid email format"),
		password: z.string().min(8, "Password must be atleast 8 characters long"),
		adminSecret: z.string().optional().openapi({
			description: "You can use this secret for testing admin registration.",
			example:
				"ee4ab94c5774f99ba3b0c71b3ad0c1c1031fd121538ab094962b9a2d5a7a6030", // This will auto-fill in the Swagger UI
		}),
	})
	.openapi("RegisterInput");

export const updateMeSchema = z
	.object({
		username: usernameSchema,
	})
	.openapi("UpdateMeInput");

// Login deliberately checks only that a password is present, not that it meets
// the registration policy: rejecting a short password here would leak that the
// stored one is longer, and would lock out accounts predating a policy change.
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
		user: z.object({
			id: z.string(),
			username: z.string(),
			email: z.email(),
		}),
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
