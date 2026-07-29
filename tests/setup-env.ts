/**
 * Seed mandatory structural environment variables
 * to satisfy the immediate initialization assertions in
 * src/config/env.config.ts.
 */

process.env.NODE_ENV = "test";
process.env.PORT = "3001";

process.env.DATABASE_URL =
	"postgresql://mock_user:mock_pass@localhost:5432/mock_db?schema=public";

process.env.REDIS_URL = "redis://127.0.0.1:6379/0";

process.env.JWT_ACCESS_TOKEN_SECRET =
	"mock_super_secret_access_token_signature_string_123456789";

process.env.JWT_REFRESH_TOKEN_SECRET =
	"mock_super_secret_refresh_token_signature_string_123456789";

process.env.CLOUDINARY_CLOUD_NAME = "mock_cloud_name";
process.env.CLOUDINARY_API_KEY = "mock_api_key";
process.env.CLOUDINARY_API_SECRET = "mock_api_secret";

process.env.BULL_BOARD_USERNAME = "mock_admin";
process.env.BULL_BOARD_PASSWORD = "mock_secure_password";

process.env.SMTP_USER = "test@gmail.com";
process.env.SMTP_PASS = "qetk adss fhsa cnff";
process.env.SMTP_FROM = "Forum Platform Security <test@gmail.com>";
