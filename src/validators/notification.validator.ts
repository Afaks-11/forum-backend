import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);

export const notificationIdParamSchema = z.object({
	id: z.uuid("Invalid notification UUID format"),
});
