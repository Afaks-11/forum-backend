import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { env } from "../config/env.config.js";
import { PrismaClient } from "../generated/prisma/client.js";

const connectionString = env.postgresql.url;

const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
export const prisma = new PrismaClient({ adapter });
