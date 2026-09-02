import { asyncHandler } from "../middlewares/asyncHandler.js";
import { getReports, resolveReport } from "../services/report.service.js";
import {
	reportIdParamSchema,
	reportListQuerySchema,
	resolveReportSchema,
} from "../validators/report.validator.js";

export const listReports = asyncHandler(async (req, res) => {
	const query = reportListQuerySchema.parse(req.query);
	const result = await getReports(query);
	res.status(200).json({
		success: true,
		data: result.items,
		meta: { nextCursor: result.nextCursor },
	});
});

export const patchReport = asyncHandler(async (req, res) => {
	const { id } = reportIdParamSchema.parse(req.params);
	const input = resolveReportSchema.parse(req.body);
	const data = await resolveReport(id, res.locals.user.userId, input);
	res.status(200).json({ success: true, data });
});
