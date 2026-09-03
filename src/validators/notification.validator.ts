import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

// Adds `.openapi()` to the shared Zod instance. Repeated per module because
// import order is not guaranteed; the call is idempotent.
extendZodWithOpenApi(z);

export const notificationIdParamSchema = z.object({
	id: z.uuid("Invalid notification UUID format"),
});

export const notificationListQuerySchema = z.object({
	limit: z
		.string()
		.optional()
		.transform((value) => (value ? Number.parseInt(value, 10) : 20))
		.pipe(z.number().int().min(1).max(50)),
	cursor: z.uuid().optional(),
});
