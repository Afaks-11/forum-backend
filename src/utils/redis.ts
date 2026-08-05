import { Redis } from "ioredis";
import { env } from "../config/env.config.js";
import { logger } from "./logger.js";

/**
 * Cache facade over a single shared ioredis connection.
 * Every operation swallows its errors and degrades to a cache miss, so a Redis
 * outage slows the API down instead of taking it offline.
 */
class RedisService {
	private client: Redis;
	private url: string;

	constructor() {
		this.url = env.redis.url;
		this.client = this.createClient(this.url);
	}

	private createClient(url: string): Redis {
		const client = new Redis(url, {
			maxRetriesPerRequest: 3,
		});
		client.on("connect", () => logger.info("Redis connection established."));
		client.on("error", (err) =>
			logger.error({ err }, "Redis connection error: "),
		);
		return client;
	}

	/**
	 * Recreate the Redis client with a new URL.
	 * Call this when the Redis endpoint changes (e.g., Testcontainers restart).
	 *
	 * IMPORTANT: This does NOT rewire BullMQ queues or Socket.IO adapters.
	 * Those must be re-initialized separately after this call.
	 */
	reconnect(url?: string): void {
		const targetUrl = url || this.url;
		if (!targetUrl) {
			logger.warn("Redis reconnect called without a URL");
			return;
		}

		try {
			if (this.client) {
				this.client.removeAllListeners();
				// quit() drains the command queue; if the old endpoint is already
				// unreachable it rejects, so fall back to disconnect() to guarantee
				// the socket and its retry timer are actually released.
				this.client.quit().catch(() => this.client.disconnect());
			}
		} catch {
			// ignore cleanup errors
		}

		this.url = targetUrl;
		this.client = this.createClient(targetUrl);
	}

	/**
	 * Close the underlying connection and stop its reconnection timer.
	 *
	 * Required for a clean process exit. Without it ioredis keeps the event loop
	 * alive and — once the endpoint disappears (SIGTERM in production, a stopped
	 * Testcontainer in tests) — retries forever, emitting ECONNREFUSED on every
	 * attempt. Listeners are removed first so teardown stays quiet without
	 * suppressing the error logging that matters at runtime.
	 */
	async disconnect(): Promise<void> {
		this.client.removeAllListeners();
		try {
			await this.client.quit();
		} catch {
			// Endpoint already gone: drop the socket instead of reconnecting.
			this.client.disconnect();
		}
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
	 * Delete every key matching a wildcard pattern (e.g. "feed:advanced:*").
	 * Uses a cursor-based SCAN rather than KEYS because KEYS blocks the whole
	 * Redis server for the duration of the sweep.
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

	async flushdb(): Promise<void> {
		try {
			await this.client.flushdb();
		} catch (error) {
			logger.error({ err: error }, "Redis FLUSHDB error");
		}
	}
}

export const redis = new RedisService();
