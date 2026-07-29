import jwt from "jsonwebtoken";

let accessSecret: string | undefined;

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
