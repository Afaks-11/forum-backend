import { AppError } from "../errors/AppError.js";
import { reportRepository } from "../repositories/index.js";
import type {
	ReportListQueryInput,
	ResolveReportInput,
} from "../validators/report.validator.js";

export const getReports = async (query: ReportListQueryInput) =>
	reportRepository.list(query.target, query.status, query.limit, query.cursor);

export const resolveReport = async (
	id: string,
	resolverId: string,
	input: ResolveReportInput,
) => {
	const report = await reportRepository.resolve(
		input.target,
		id,
		resolverId,
		input.status,
		input.resolutionNote,
	);
	if (!report) throw new AppError("Report not found", 404);
	return report;
};
