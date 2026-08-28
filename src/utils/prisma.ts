import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { env } from "../config/env.config.js";
import { PrismaClient } from "../generated/prisma/client.js";

const connectionString = env.postgresql.url;

/**
 * Shared connection pool for the whole process.
 *
 * Every value here exists to bound worst-case latency. Left at pg's defaults the
 * pool waits forever for a free connection and never cancels a slow statement,
 * so a handful of expensive queries pin all ten connections and every
 * subsequent request queues invisibly — no errors, just latency climbing until
 * clients time out. Explicit budgets convert that silent pile-up into fast,
 * visible failures the readiness probe and error logs can actually report.
 *
 * `statement_timeout` is generous enough for the batched ranking UPDATE (one
 * thousand rows in a single statement) while still killing runaway scans.
 */
const pool = new pg.Pool({
	connectionString,
	max: 10,
	// Give up waiting for a free connection instead of queueing indefinitely.
	connectionTimeoutMillis: 5_000,
	// Recycle connections that have been parked long enough to have gone stale
	// behind a proxy or a restarted database.
	idleTimeoutMillis: 30_000,
	statement_timeout: 10_000,
	query_timeout: 10_000,
});

const adapter = new PrismaPg(pool);
export const prisma = new PrismaClient({ adapter });
