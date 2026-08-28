import { rateLimit } from "express-rate-limit";
import { type RedisReply, RedisStore } from "rate-limit-redis";
import { redis } from "../utils/redis.js";

/**
 * Paths excluded from the global bucket.
 *
 * Liveness/readiness probes and Prometheus scrapes arrive on a fixed schedule
 * from infrastructure rather than from users. Metering them means an
 * orchestrator's health checks and a scrape interval compete with real traffic
 * for the same 100-per-10-minute allowance, and once exhausted the platform
 * starts seeing 429s on `/health/ready` and pulls a healthy instance.
 */
const UNMETERED_PREFIXES = ["/health", "/metrics"];

const isUnmetered = (path: string): boolean =>
	UNMETERED_PREFIXES.some(
		(prefix) => path === prefix || path.startsWith(`${prefix}/`),
	);

/**
 * Baseline per-IP limiter applied across the API.
 * Counters live in Redis rather than process memory so the limit holds across
 * restarts and multiple instances.
 *
 * `passOnStoreError` is deliberately on. This middleware gates 100% of traffic,
 * and the library default (`false`) propagates a store rejection to the error
 * handler — turning a Redis hiccup into a 500 on every single request. Failing
 * open matches the policy the rest of the Redis facade already follows:
 * degrade the optional guarantee, keep serving. A brief unmetered window is a
 * smaller incident than a total outage, and readiness reporting already
 * surfaces the underlying Redis state.
 */
export const limiter = rateLimit({
	windowMs: 10 * 60 * 1000,
	limit: 100,
	standardHeaders: "draft-8",
	legacyHeaders: false,
	ipv6Subnet: 56,
	passOnStoreError: true,
	skip: (req) => isUnmetered(req.path),
	store: new RedisStore({
		sendCommand: (...args: string[]) =>
			redis
				.getClient()
				.call(...(args as [string, ...string[]])) as Promise<RedisReply>,
	}),
});

/**
 * Stricter limiter for sensitive authentication endpoints
 * (login, register, password reset, verification resend) to slow down
 * credential-stuffing and account-enumeration abuse.
 *
 * This one fails open too, for the same reason: an unreachable Redis must not
 * make logging in impossible. The account-level lockout in `loginUser` is the
 * defence that does not depend on Redis.
 */
export const authLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	limit: 10,
	standardHeaders: "draft-8",
	legacyHeaders: false,
	ipv6Subnet: 56,
	passOnStoreError: true,
	message: {
		success: false,
		message: "Too many attempts. Please try again later.",
	},
	store: new RedisStore({
		prefix: "rl:auth:",
		sendCommand: (...args: string[]) =>
			redis
				.getClient()
				.call(...(args as [string, ...string[]])) as Promise<RedisReply>,
	}),
});
