import { rateLimit } from "express-rate-limit";
import { type RedisReply, RedisStore } from "rate-limit-redis";
import { redis } from "../utils/redis.js";

export const limiter = rateLimit({
	windowMs: 10 * 60 * 1000,
	limit: 100,
	standardHeaders: "draft-8",
	legacyHeaders: false,
	ipv6Subnet: 56,
	store: new RedisStore({
		sendCommand: (...args: string[]) =>
			redis
				.getClient()
				.call(...(args as [string, ...string[]])) as Promise<RedisReply>,
	}),
});
