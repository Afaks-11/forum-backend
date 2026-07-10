import { Redis } from "ioredis";
import { env } from "../config/env.config.js";

export const createQueueConnection = (): Redis => {
	return new Redis(env.redis.url, {
		maxRetriesPerRequest: null,
	});
};
