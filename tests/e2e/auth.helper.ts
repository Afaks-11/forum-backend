import type { Application } from "express";
import supertest from "supertest";
import { getE2EDatabase } from "./test-db.js";

export async function registerUser(
	app: Application,
	payload: { username: string; email: string; password: string },
) {
	return supertest(app).post("/api/v1/auth/register").send(payload);
}

export async function verifyEmail(app: Application, token: string) {
	return supertest(app).post("/api/v1/auth/verify-email").send({ token });
}

export async function loginUser(
	app: Application,
	payload: { email: string; password: string },
) {
	return supertest(app).post("/api/v1/auth/login").send(payload);
}

/**
 * Full registration → verification → login flow.
 * Returns the user record and access token.
 */
export async function createVerifiedUser(
	app: Application,
	overrides: Partial<{
		username: string;
		email: string;
		password: string;
	}> = {},
) {
	const db = getE2EDatabase();

	const username =
		overrides.username ??
		`e2e_test_${Date.now().toString(36).slice(-6)}${Math.random().toString(36).slice(2, 5)}`;
	const email = overrides.email ?? `${username}@e2e.local`;
	const password = overrides.password ?? "SecurePassword123!";

	const registerRes = await registerUser(app, { username, email, password });
	if (registerRes.status !== 201) {
		throw new Error(
			`Registration failed: ${registerRes.status} ${JSON.stringify(registerRes.body)}`,
		);
	}

	const userRecord = await db.user.findUnique({ where: { email } });
	if (!userRecord?.emailVerifyToken) {
		throw new Error("Verification token not found in database");
	}

	const verifyRes = await verifyEmail(app, userRecord.emailVerifyToken);
	if (verifyRes.status !== 200) {
		throw new Error(
			`Verification failed: ${verifyRes.status} ${JSON.stringify(verifyRes.body)}`,
		);
	}

	const loginRes = await loginUser(app, { email, password });
	if (loginRes.status !== 200) {
		throw new Error(
			`Login failed: ${loginRes.status} ${JSON.stringify(loginRes.body)}`,
		);
	}

	return {
		id: userRecord.id,
		username,
		email,
		password,
		accessToken: loginRes.body.data.accessToken as string,
	};
}

/**
 * Creates a verified user who owns a community containing one post.
 *
 * Voting, notification and moderation tests all need this exact arrangement.
 * Building it here keeps that setup in one place instead of repeating the
 * three-request dance in every spec.
 */
export async function createUserWithPost(
	app: Application,
	overrides: { communityName?: string; postTitle?: string } = {},
) {
	const author = await createVerifiedUser(app);
	const suffix = Math.random().toString(36).slice(2, 8);

	const communityRes = await supertest(app)
		.post("/api/v1/communities")
		.set("Authorization", `Bearer ${author.accessToken}`)
		.send({
			// `createCommunitySchema` restricts names to /^[a-zA-Z0-9-]+$/, so the
			// separator must be a hyphen; an underscore fails validation with 400.
			name: overrides.communityName ?? `c-${suffix}`,
			description: "Fixture community created for end-to-end coverage.",
		});

	if (communityRes.status !== 201) {
		throw new Error(
			`Community creation failed: ${communityRes.status} ${JSON.stringify(communityRes.body)}`,
		);
	}

	const postRes = await supertest(app)
		.post("/api/v1/posts")
		.set("Authorization", `Bearer ${author.accessToken}`)
		.send({
			title: overrides.postTitle ?? `Fixture post ${suffix}`,
			content: "Fixture post body created for end-to-end coverage.",
			type: "TEXT",
			communityId: communityRes.body.data.id,
		});

	if (postRes.status !== 201) {
		throw new Error(
			`Post creation failed: ${postRes.status} ${JSON.stringify(postRes.body)}`,
		);
	}

	return {
		author,
		communityId: communityRes.body.data.id as string,
		postId: postRes.body.data.id as string,
	};
}
