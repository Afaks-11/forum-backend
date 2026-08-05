import { redis } from "../utils/redis.js";

export class TokenBlacklistRepository {
	private readonly PREFIX;

	constructor() {
		this.PREFIX = "blacklist:token";
	}

	/**
	 * Revokes a token until it would have expired anyway. The TTL matches the
	 * token's remaining lifetime so entries expire themselves and the blacklist
	 * never grows without bound.
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
		const result = await redis.exists(`${this.PREFIX}${token}`);
		return Boolean(result);
	}
}
