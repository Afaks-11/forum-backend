/**
 * Strict structural interface representing the application domain user layout.
 */
export interface UserFixture {
	id: string;
	username: string;
	email: string;
	password: string;
	isEmailVerified: boolean;
	loginAttempts: number;
	lockUntil: Date | null;
	passwordResetToken: string | null;
	passwordResetExpires: Date | null;
	createdAt: Date;
}

/**
 * Generates an isolated, immutable user data snapshot.
 * Supports partial overrides for targeted test cases (e.g., locked or verified states).
 */
export const createFakeUser = (
	overrides: Partial<UserFixture> = {},
): UserFixture => {
	return {
		id: "usr_clnt7777x0000abcde1234567",
		username: "architect_dev",
		email: "engineering@forum.com",
		password: "$2b$10$LwRzXm8/5V3M2D4V6E8R9O.MockHashedBcryptStringPayloadHere",
		isEmailVerified: false,
		loginAttempts: 0,
		lockUntil: null,
		passwordResetToken: null,
		passwordResetExpires: null,
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		...overrides,
	};
};
