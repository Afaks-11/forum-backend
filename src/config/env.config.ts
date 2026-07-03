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
} as const;
