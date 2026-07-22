import { Redis } from "ioredis";
import { env } from "../config/env.config.js";
import { logger } from "./logger.js";

class RedisService {
	private client: Redis;

	constructor() {
		this.client = new Redis(env.redis.url, {
			maxRetriesPerRequest: 3,
		});
		this.client.on("connect", () =>
			logger.info("Redis connection established."),
		);
		this.client.on("error", (err) =>
			logger.error({ err }, "Redis connection error: "),
		);
	}

	/**
	 * Get a deserialized value from cache
	 */
	async get<T>(key: string): Promise<T | null> {
		try {
			const value = await this.client.get(key);
			if (!value) return null;
			return JSON.parse(value) as T;
		} catch (error) {
			logger.error(
				{ err: error, cachekey: key },
				`Redis GET error for key ${key}: `,
			);
			return null;
		}
	}

	/**
	 * Set a serialized value with a TTL (Time To Live in seconds)
	 */
	async set(key: string, value: unknown, ttlSeconds = 3600): Promise<void> {
		try {
			const serialized = JSON.stringify(value);
			await this.client.set(key, serialized, "EX", ttlSeconds);
		} catch (error) {
			logger.error(
				{ err: error, cachekey: key },
				`Redis SET error for key ${key}: `,
			);
		}
	}

	/**
	 * Delete a key from cache (Invalidation)
	 */
	async del(key: string): Promise<void> {
		try {
			await this.client.del(key);
		} catch (error) {
			logger.error(
				{ err: error, cachekey: key },
				`Redis DEL errror for key ${key}: `,
			);
		}
	}

	/**
	 * Check if a key exists
	 */
	async exists(key: string): Promise<boolean> {
		try {
			const result = await this.client.exists(key);
			return result === 1;
		} catch (error) {
			logger.error(
				{ err: error, cachekey: key },
				`Redis EXISTS validation error for key ${key}`,
			);
			return false;
		}
	}

	/**
	 * Get raw client for specialized uses (like rate-limiting stores)
	 */
	getClient(): Redis {
		return this.client;
	}

	/**
	 * Safely scan and delete all keys matching a wildcard pattern (e.g., "feed:advanced:*")
	 */
	async delPattern(pattern: string): Promise<void> {
		const client = this.client;
		let cursor = "0";
		try {
			do {
				const reply = await client.scan(cursor, "MATCH", pattern, "COUNT", 100);
				cursor = reply[0];
				const keys = reply[1];
				if (keys.length > 0) {
					await client.del(...keys);
				}
			} while (cursor !== "0");
		} catch (error) {
			logger.error(
				{ err: error, searchPattern: pattern },
				`Redis batch pattern deletion failed`,
			);
		}
	}
}

export const redis = new RedisService();
