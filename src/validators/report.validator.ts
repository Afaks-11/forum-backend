import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);

export const reportListQuerySchema = z.object({
	target: z.enum(["POST", "COMMENT"]).default("POST"),
	status: z.enum(["PENDING", "RESOLVED", "DISMISSED"]).optional(),
	limit: z
		.string()
		.optional()
		.transform((value) => (value ? Number.parseInt(value, 10) : 20))
		.pipe(z.number().int().min(1).max(50)),
	cursor: z.uuid().optional(),
});

export const reportIdParamSchema = z.object({ id: z.uuid() });

export const resolveReportSchema = z
	.object({
		target: z.enum(["POST", "COMMENT"]),
		status: z.enum(["RESOLVED", "DISMISSED"]),
		resolutionNote: z.string().trim().min(1).max(1000).optional(),
	})
	.strict();

export type ReportListQueryInput = z.infer<typeof reportListQuerySchema>;
export type ResolveReportInput = z.infer<typeof resolveReportSchema>;
