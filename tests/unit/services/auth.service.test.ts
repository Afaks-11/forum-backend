import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { AppError } from "../../../src/errors/AppError.js";

// Module Level Repository Mocks & Isolation
const mockUserRepository = {
	findByEmailOrUsername: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	create: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	findByEmail: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	findById: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	findByUsername: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	findProfileById: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	updateLoginLockState: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	updateProfile: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	softDelete: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	updatePassword: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	updateResetCredentials: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	findByResetToken: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	resetPasswordAndClearTokens:
		jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	findByVerifyToken: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	verifyEmailStatus: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	updateVerificationToken: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	incrementLoginAttemptsAtomic:
		jest.fn<(...args: unknown[]) => Promise<unknown>>(),
};

const mockTokenBlacklistRepository = {
	isBlacklisted: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	blacklist: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
};

const mockEmailQueue = {
	add: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
};

await jest.unstable_mockModule("../../../src/repositories/index.js", () => ({
	userRepository: mockUserRepository,
	tokenBlacklistRepository: mockTokenBlacklistRepository,
}));
await jest.unstable_mockModule("../../../src/queues/email.queue.js", () => ({
	emailQueue: mockEmailQueue,
}));

// Import service layer target after mock setup
const {
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
} = await import("../../../src/services/auth.service.js");
const { createFakeUser } = await import("../../fixtures/user.fixture.js");

describe("Auth Service Unit Test Suite", () => {
	// `resetMocks` in jest.config.cjs strips every mock implementation before each
	// test, so `emailQueue.add` would return `undefined` rather than a promise.
	// The service chains `.catch()` onto that call for fire-and-forget notices,
	// which throws on `undefined`. Re-arm the queue stub for every test.
	beforeEach(() => {
		mockEmailQueue.add.mockResolvedValue(undefined);
	});

	// REGISTER USER TESTS
	describe("registerUser", () => {
		it("Happy Path: should successfully hash password and register a unique new user account", async () => {
			const registerInput = {
				email: "senior.dev@forum.com",
				username: "testengineer",
				password: "SecurePassword123!",
			};
			const mockSavedUser = {
				id: "usr_123",
				email: registerInput.email,
				username: registerInput.username,
				createdAt: new Date(),
			};

			mockUserRepository.findByEmailOrUsername.mockResolvedValue(null);
			mockUserRepository.create.mockResolvedValue(mockSavedUser);

			const result = await registerUser(registerInput);

			expect(mockUserRepository.findByEmailOrUsername).toHaveBeenCalledWith(
				registerInput.email,
				registerInput.username,
			);
			expect(result).toEqual(mockSavedUser);
			expect(mockEmailQueue.add).toHaveBeenCalled();
		});

		it("Business Rule: should throw 409 AppError if user email or username exists", async () => {
			mockUserRepository.findByEmailOrUsername.mockResolvedValue(
				createFakeUser(),
			);

			await expect(
				registerUser({
					email: "duplicate@forum.com",
					username: "duplicate",
					password: "Password123!",
				}),
			).rejects.toThrow(new AppError("Username or email already taken", 409));
		});
	});

	// LOGIN USER TESTS
	describe("loginUser", () => {
		it("Happy Path: should verify credentials and issue security tokens upon a valid login request", async () => {
			const fakeUser = createFakeUser({ isEmailVerified: true });
			mockUserRepository.findByEmail.mockResolvedValue(fakeUser);
			jest
				.spyOn(bcrypt, "compare")
				.mockImplementation(() => Promise.resolve(true));
			mockUserRepository.updateLoginLockState.mockResolvedValue({} as never);

			const result = await loginUser({
				email: fakeUser.email,
				password: "SecurePassword123!",
			});

			expect(result).toHaveProperty("accessToken");
			expect(result).toHaveProperty("refreshToken");
			expect(result.user.email).toBe(fakeUser.email);
			expect(mockUserRepository.updateLoginLockState).toHaveBeenCalledWith(
				fakeUser.id,
				{
					loginAttempts: 0,
					lockUntil: null,
				},
			);
		});

		it("Timing Attack Fix: should run cryptographic validation even if the target user account is missing", async () => {
			mockUserRepository.findByEmail.mockResolvedValue(null);
			const bcryptSpy = jest
				.spyOn(bcrypt, "compare")
				.mockImplementation(() => Promise.resolve(false));

			await expect(
				loginUser({ email: "missing@test.com", password: "somePassword" }),
			).rejects.toThrow(
				new AppError("Invalid email or password credentials", 400),
			);

			expect(bcryptSpy).toHaveBeenCalled();
		});

		it("Account Lockout: should throw 423 AppError if user has an active lockout window expiration date", async () => {
			const lockedUser = createFakeUser({
				lockUntil: new Date(Date.now() + 10 * 60 * 1000),
			});
			mockUserRepository.findByEmail.mockResolvedValue(lockedUser);
			jest
				.spyOn(bcrypt, "compare")
				.mockImplementation(() => Promise.resolve(true));

			await expect(
				loginUser({ email: lockedUser.email, password: "anyPassword" }),
			).rejects.toThrow(expect.objectContaining({ statusCode: 423 }));
		});

		it("Concurrency Fix: should invoke atomic increments directly inside DB on login failure", async () => {
			const fakeUser = createFakeUser();
			mockUserRepository.findByEmail.mockResolvedValue(fakeUser);
			jest
				.spyOn(bcrypt, "compare")
				.mockImplementation(() => Promise.resolve(false));
			mockUserRepository.incrementLoginAttemptsAtomic.mockResolvedValue({
				loginAttempts: 5,
			});

			await expect(
				loginUser({ email: fakeUser.email, password: "wrongPassword" }),
			).rejects.toThrow(
				new AppError("Account locked due to multiple login failures.", 423),
			);

			expect(
				mockUserRepository.incrementLoginAttemptsAtomic,
			).toHaveBeenCalledWith(fakeUser.id);
			expect(mockEmailQueue.add).toHaveBeenCalledWith(
				expect.stringContaining("login-attempt-failed:"),
				expect.any(Object),
			);
		});

		it("Unverified Account: should throw 403 AppError if user email flag remains unverified", async () => {
			const unverifiedUser = createFakeUser({ isEmailVerified: false });
			mockUserRepository.findByEmail.mockResolvedValue(unverifiedUser);
			jest
				.spyOn(bcrypt, "compare")
				.mockImplementation(() => Promise.resolve(true));

			await expect(
				loginUser({ email: unverifiedUser.email, password: "Password123!" }),
			).rejects.toThrow(
				new AppError(
					"Please check your inbox and verify your email to log in.",
					403,
				),
			);
		});
	});

	// REFRESH TOKEN TESTS
	describe("refreshAccessToken", () => {
		it("Security Rule: should throw 401 AppError if the refresh token is listed inside the blacklist", async () => {
			mockTokenBlacklistRepository.isBlacklisted.mockResolvedValue(true);

			await expect(refreshAccessToken("blacklisted_token")).rejects.toThrow(
				new AppError("Invalid or expired refresh token", 401),
			);
		});

		it("Compound Key Validation: should successfully verify token when using signature matching password hash", async () => {
			const fakeUser = createFakeUser({
				id: "usr_789",
				password: "current_hashed_password",
			});
			mockTokenBlacklistRepository.isBlacklisted.mockResolvedValue(false);

			jest.spyOn(jwt, "decode").mockReturnValue({ userId: "usr_789" });
			mockUserRepository.findById.mockResolvedValue(fakeUser);
			jest.spyOn(jwt, "verify").mockReturnValue({ userId: "usr_789" } as never);

			const result = await refreshAccessToken("valid_token");
			expect(result).toBeDefined();
		});

		it("Session Revocation: should reject verification if user changed password changing their database hash", async () => {
			const fakeUser = createFakeUser({
				id: "usr_789",
				password: "NEW_hashed_password_abc",
			});
			mockTokenBlacklistRepository.isBlacklisted.mockResolvedValue(false);

			jest.spyOn(jwt, "decode").mockReturnValue({ userId: "usr_789" });
			mockUserRepository.findById.mockResolvedValue(fakeUser);

			jest.spyOn(jwt, "verify").mockImplementation(() => {
				throw new Error("JsonWebTokenError: invalid signature");
			});

			await expect(refreshAccessToken("old_stale_token")).rejects.toThrow(
				new AppError("Invalid or expired refresh token", 401),
			);
		});
	});

	// BLACKLIST TOKEN TESTS
	describe("blacklistRefreshToken", () => {
		it("Happy Path: should push active token parameters into redis cache matching calculated lifespan", async () => {
			const mockExp = Math.floor(Date.now() / 1000) + 3600;
			jest.spyOn(jwt, "decode").mockReturnValue({ exp: mockExp });
			mockTokenBlacklistRepository.blacklist.mockResolvedValue({} as never);

			await blacklistRefreshToken("token_to_blacklist");

			expect(mockTokenBlacklistRepository.blacklist).toHaveBeenCalledWith(
				"token_to_blacklist",
				expect.any(Number),
			);
		});
	});

	// PROFILE OPERATIONS TESTS
	describe("Profile CRUD Operations", () => {
		it("getUserProfile: should fetch user profile details or throw 404", async () => {
			mockUserRepository.findProfileById.mockResolvedValue(null);
			await expect(getUserProfile("usr_missing")).rejects.toThrow(
				new AppError("User not found", 404),
			);
		});

		it("updateUserProfile: should catch duplicated identity constraints when changing username values", async () => {
			const concurrentUser = createFakeUser({ id: "usr_clashing" });
			mockUserRepository.findByUsername.mockResolvedValue(concurrentUser);

			await expect(
				updateUserProfile({ username: "clashing" }, "usr_current"),
			).rejects.toThrow(new AppError("Username already taken", 409));
		});

		it("deleteUserAccount: should cleanly hand-off user deletion directives to database layer", async () => {
			mockUserRepository.softDelete.mockResolvedValue({ success: true });
			const res = await deleteUserAccount("usr_delete");
			expect(res).toBeDefined();
			expect(mockUserRepository.softDelete).toHaveBeenCalledWith("usr_delete");
		});
	});

	// PASSWORD MANAGEMENT TESTS
	describe("changeUserPassword", () => {
		it("Happy Path: should complete user password updates if old validation parameters evaluate to true", async () => {
			const fakeUser = createFakeUser();
			mockUserRepository.findById.mockResolvedValue(fakeUser);
			jest
				.spyOn(bcrypt, "compare")
				.mockImplementation(() => Promise.resolve(true));
			mockUserRepository.updatePassword.mockResolvedValue({} as never);

			await changeUserPassword(
				{ oldPassword: "Old", newPassword: "New" },
				fakeUser.id,
			);
			expect(mockUserRepository.updatePassword).toHaveBeenCalled();
		});
	});

	describe("processForgotPassword", () => {
		it("Happy Path: should save temporary reset criteria details inside storage layer", async () => {
			const fakeUser = createFakeUser();
			mockUserRepository.findByEmail.mockResolvedValue(fakeUser);
			mockUserRepository.updateResetCredentials.mockResolvedValue({} as never);

			await processForgotPassword(fakeUser.email);
			expect(mockUserRepository.updateResetCredentials).toHaveBeenCalled();
		});
	});

	describe("processResetPassword", () => {
		it("Happy Path: should wipe ephemeral credential keys when verifying valid reset payloads", async () => {
			const activeUser = createFakeUser({
				passwordResetExpires: new Date(Date.now() + 15 * 60 * 1000),
			});
			mockUserRepository.findByResetToken.mockResolvedValue(activeUser);
			mockUserRepository.resetPasswordAndClearTokens.mockResolvedValue(
				{} as never,
			);

			await processResetPassword({
				token: "token_abc",
				newPassword: "BrandNewSecure",
			});
			expect(mockUserRepository.resetPasswordAndClearTokens).toHaveBeenCalled();
		});

		it("Expiration Boundary: should reject update procedures if token window value has passed", async () => {
			const expiredUser = createFakeUser({
				passwordResetExpires: new Date(Date.now() - 1000),
			});
			mockUserRepository.findByResetToken.mockResolvedValue(expiredUser);

			await expect(
				processResetPassword({ token: "expired", newPassword: "Pass" }),
			).rejects.toThrow(
				new AppError("Invalid or expired password reset token", 401),
			);
		});
	});

	// ACCOUNT VERIFICATION TESTS
	describe("Account Verification Workflow", () => {
		it("resendVerificationToken: should issue alternative verification tokens upon client request", async () => {
			const user = createFakeUser({ isEmailVerified: false });
			mockUserRepository.findByEmail.mockResolvedValue(user);
			mockUserRepository.updateVerificationToken.mockResolvedValue({} as never);

			await resendVerificationToken(user.email);
			expect(mockUserRepository.updateVerificationToken).toHaveBeenCalled();
		});

		it("verifyUserEmail: should safely process registration confirmation tokens", async () => {
			const user = createFakeUser();
			mockUserRepository.findByVerifyToken.mockResolvedValue(user);
			mockUserRepository.verifyEmailStatus.mockResolvedValue({} as never);

			await verifyUserEmail("token_val");
			expect(mockUserRepository.verifyEmailStatus).toHaveBeenCalledWith(
				user.id,
			);
		});

		it("verifyUserEmail: should reject a token whose expiry window has already elapsed", async () => {
			const user = createFakeUser({
				verificationTokenExpires: new Date(Date.now() - 1000),
			});
			mockUserRepository.findByVerifyToken.mockResolvedValue(user);

			await expect(verifyUserEmail("stale_token")).rejects.toThrow(
				new AppError("Verification token has expired", 401),
			);
			expect(mockUserRepository.verifyEmailStatus).not.toHaveBeenCalled();
		});

		it("verifyUserEmail: should reject an unknown token without touching the database", async () => {
			mockUserRepository.findByVerifyToken.mockResolvedValue(null);

			await expect(verifyUserEmail("nonexistent")).rejects.toThrow(
				new AppError("Invalid or expired verification token", 401),
			);
			expect(mockUserRepository.verifyEmailStatus).not.toHaveBeenCalled();
		});
	});
});
