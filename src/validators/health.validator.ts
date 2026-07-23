import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);

export const HealthStatusSchema = z.object({
	status: z.string().openapi({ example: "UP" }),
	timestamp: z.date().openapi({ example: "2026-07-22T21:30:00.000Z" }),
	uptime: z.number().openapi({ example: 145.23 }),
});

export const DeepReadinessSchema = z.object({
	status: z.string().openapi({ example: "UP" }),
	timestamp: z.date(),
	services: z.object({
		database: z.string().openapi({ example: "UP" }),
		cache: z.string().openapi({ example: "UP" }),
		queue: z.string().openapi({ example: "UP" }),
		realtime: z.string().openapi({ example: "UP" }),
	}),
});
