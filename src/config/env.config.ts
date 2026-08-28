// Required values throw at import time so a misconfigured deployment fails on
// boot rather than at the first request that happens to need the secret.
const getEnvOrThrow = (key: string): string => {
	const value = process.env[key];
	if (!value) {
		throw new Error(
			`Configuration Error: Environment variable '${key}' is missing.`,
		);
	}
	return value;
};

export const env = {
	cloudinaryConfig: {
		cloudName: getEnvOrThrow("CLOUDINARY_CLOUD_NAME"),
		apiKey: getEnvOrThrow("CLOUDINARY_API_KEY"),
		apiSecret: getEnvOrThrow("CLOUDINARY_API_SECRET"),
	},
	app: {
		nodeEnv: process.env.NODE_ENV ?? "development",
		port: parseInt(process.env.PORT ?? "3000", 10),
		// Number of reverse-proxy hops in front of this process. Express needs it
		// to resolve the real client IP from `X-Forwarded-For`; without it every
		// caller behind a proxy shares one rate-limit bucket, and with too high a
		// value a client can forge the header and get its own. `1` matches the
		// documented deployment shape (single load balancer or ingress); set it to
		// `0` when the process is exposed directly.
		trustProxyHops: parseInt(process.env.TRUST_PROXY_HOPS ?? "1", 10),
		corsOrigins: (
			process.env.CORS_ORIGINS ?? "http://localhost:3000,http://localhost:5173"
		)
			.split(",")
			.map((origin) => origin.trim())
			.filter(Boolean),
	},
	redis: {
		url: getEnvOrThrow("REDIS_URL"),
	},
	jwt: {
		accessSecret: getEnvOrThrow("JWT_ACCESS_TOKEN_SECRET"),
		refreshSecret: getEnvOrThrow("JWT_REFRESH_TOKEN_SECRET"),
	},
	postgresql: {
		url: getEnvOrThrow("DATABASE_URL"),
	},
	bullBoard: {
		username: getEnvOrThrow("BULL_BOARD_USERNAME"),
		password: getEnvOrThrow("BULL_BOARD_PASSWORD"),
	},
	smtp: {
		smtp_user: getEnvOrThrow("SMTP_USER"),
		smtp_pass: getEnvOrThrow("SMTP_PASS"),
		smtp_from: getEnvOrThrow("SMTP_FROM"),
	},
	admin: {
		adminRegistrationSecret: getEnvOrThrow("ADMIN_REGISTRATION_SECRET"),
	},
} as const;
