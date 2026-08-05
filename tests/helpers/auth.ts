import jwt from "jsonwebtoken";

let accessSecret: string | undefined;

// The env config is imported dynamically and cached: it validates on first
// import, so a static import here would run before the setup file has seeded
// the test environment variables.
async function loadSecret() {
	if (accessSecret) return accessSecret;
	const { env } = await import("../../src/config/env.config.js");
	accessSecret = env.jwt.accessSecret;
	return accessSecret;
}

export async function generateAccessToken(userId: string): Promise<string> {
	const secret = await loadSecret();
	return jwt.sign({ userId }, secret, { expiresIn: "15m" });
}
