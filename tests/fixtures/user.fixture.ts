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
	// Named to match the Prisma column (`emailVerifyToken`), not the service-layer
	// input field (`verificationToken`), because fixtures stand in for rows.
	emailVerifyToken: string | null;
	verificationTokenExpires: Date | null;
	deletedAt: Date | null;
	createdAt: Date;
}

/**
 * Generates an isolated, immutable user data snapshot.
 * Supports partial overrides for targeted test cases (e.g., locked or verified states).
 *
 * Defaults describe a *live, unexpired* account: `deletedAt` is null and the
 * verification token is dated into the future. Services now reject soft-deleted
 * users and expired verification tokens, so a fixture that omitted these fields
 * produced `undefined` and made every caller take the rejection branch.
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
		verificationToken: "mock_verification_token",
		verificationTokenExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
		deletedAt: null,
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		...overrides,
	};
};
