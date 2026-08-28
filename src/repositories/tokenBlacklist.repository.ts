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
	 * Reports whether a token has been revoked.
	 *
	 * Reads through the raw client rather than the `redis` facade deliberately.
	 * The facade swallows every error and returns `false`, which for this
	 * particular check means "not revoked" — a Redis outage would silently
	 * resurrect a token the user explicitly logged out for the rest of its
	 * seven-day life. Every other facade consumer trades only performance when
	 * Redis is down; this one would trade security, so the error is allowed to
	 * propagate and the caller fails closed.
	 */
	async isBlacklisted(token: string): Promise<boolean> {
		const result = await redis.getClient().exists(`${this.PREFIX}${token}`);
		return result === 1;
	}
}
