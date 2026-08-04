import { readContainerState } from "./container-state.js";

/**
 * Seeds environment variables before any application module is imported.
 *
 * `src/config/env.config.ts` resolves every variable eagerly at import time and
 * throws on missing ones, so these placeholders must exist first. They are
 * assigned with `??=` so a real value supplied by CI, a shell, or the
 * Testcontainers global setup is never clobbered.
 */
process.env.NODE_ENV ??= "test";
process.env.PORT ??= "3001";

process.env.DATABASE_URL ??=
	"postgresql://mock_user:mock_pass@localhost:5432/mock_db?schema=public";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/0";

process.env.JWT_ACCESS_TOKEN_SECRET ??=
	"mock_super_secret_access_token_signature_string_123456789";
process.env.JWT_REFRESH_TOKEN_SECRET ??=
	"mock_super_secret_refresh_token_signature_string_123456789";

process.env.CLOUDINARY_CLOUD_NAME ??= "mock_cloud_name";
process.env.CLOUDINARY_API_KEY ??= "mock_api_key";
process.env.CLOUDINARY_API_SECRET ??= "mock_api_secret";

process.env.BULL_BOARD_USERNAME ??= "mock_admin";
process.env.BULL_BOARD_PASSWORD ??= "mock_secure_password";

process.env.SMTP_USER ??= "test@example.com";
process.env.SMTP_PASS ??= "mock_smtp_password";
process.env.SMTP_FROM ??= "Forum Platform Security <test@example.com>";

/**
 * Integration and E2E runs publish live container endpoints here. Overriding
 * unconditionally is correct: a running container always beats a placeholder,
 * and this executes before the first `import` of any `src/` module.
 */
const containers = readContainerState();
if (containers) {
	process.env.DATABASE_URL = containers.databaseUrl;
	process.env.REDIS_URL = containers.redisUrl;
}
