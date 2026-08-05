import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

// Adds `.openapi()` to the shared Zod instance. Repeated per module because
// import order is not guaranteed; the call is idempotent.
extendZodWithOpenApi(z);

export const notificationIdParamSchema = z.object({
	id: z.uuid("Invalid notification UUID format"),
});
