import { redis } from "../utils/redis.js";

export class TokenBlacklistRepository {
	private readonly PREFIX;

	constructor() {
		this.PREFIX = "blacklist:token";
	}

	/**
	 * Add a refresh token to the blacklist with a set Time-To-Live (TTL) in seconds
	 */
	async blacklist(token: string, ttlSeconds: number): Promise<void> {
		await redis
			.getClient()
			.set(`${this.PREFIX}${token}`, "1", "EX", ttlSeconds);
	}

	/**
	 * Check if a token is registered on our blacklist
	 */
	async isBlacklisted(token: string): Promise<boolean> {
		return await redis.exists(`${this.PREFIX}${token}`);
	}
}
