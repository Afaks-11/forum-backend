import { Redis } from "ioredis";
import { env } from "../config/env.config.js";

class RedisService {
	private client: Redis;

	constructor() {
		this.client = new Redis(env.redis.url, {
			maxRetriesPerRequest: 3,
		});
		this.client.on("connect", () =>
			console.log("Redis connection established."),
		);
		this.client.on("error", (err) =>
			console.error("Redis connection error: ", err),
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
			console.error(`Redis GET error for key ${key}: `, error);
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
			console.error(`Redis SET error for key ${key}: `, error);
		}
	}

	/**
	 * Delete a key from cache (Invalidation)
	 */
	async del(key: string): Promise<void> {
		try {
			await this.client.del(key);
		} catch (error) {
			console.error(`Redis DEL errror for key ${key}: `, error);
		}
	}

	/**
	 * Check if a key exists
	 */
	async exists(key: string): Promise<boolean> {
		try {
			const result = await this.client.exists(key);
			return result === 1;
		} catch (_error) {
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
		do {
			const reply = await client.scan(cursor, "MATCH", pattern, "COUNT", 100);
			cursor = reply[0];
			const keys = reply[1];
			if (keys.length > 0) {
				await client.del(...keys);
			}
		} while (cursor !== "0");
	}
}

export const redis = new RedisService();
