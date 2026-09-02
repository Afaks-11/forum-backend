import { describe, expect, it, jest } from "@jest/globals";
import { AppError } from "../../../src/errors/AppError.js";

const mockReportRepository = {
	list: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	resolve: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
};

await jest.unstable_mockModule("../../../src/repositories/index.js", () => ({
	reportRepository: mockReportRepository,
}));

const { getReports, resolveReport } = await import(
	"../../../src/services/report.service.js"
);

describe("Report Service Unit Test Suite", () => {
	it("lists reports through the paginated repository boundary", async () => {
		const page = { items: [{ id: "report_1" }], nextCursor: null };
		mockReportRepository.list.mockResolvedValue(page);

		const result = await getReports({
			target: "POST",
			status: "PENDING",
			limit: 20,
		});

		expect(mockReportRepository.list).toHaveBeenCalledWith(
			"POST",
			"PENDING",
			20,
			undefined,
		);
		expect(result).toEqual(page);
	});

	it("resolves a report with the acting administrator", async () => {
		const report = { id: "report_1", status: "RESOLVED" };
		mockReportRepository.resolve.mockResolvedValue(report);

		const result = await resolveReport("report_1", "admin_1", {
			target: "POST",
			status: "RESOLVED",
			resolutionNote: "Reviewed",
		});

		expect(mockReportRepository.resolve).toHaveBeenCalledWith(
			"POST",
			"report_1",
			"admin_1",
			"RESOLVED",
			"Reviewed",
		);
		expect(result).toEqual(report);
	});

	it("rejects a missing report", async () => {
		mockReportRepository.resolve.mockResolvedValue(null);

		await expect(
			resolveReport("missing", "admin_1", {
				target: "COMMENT",
				status: "DISMISSED",
			}),
		).rejects.toThrow(new AppError("Report not found", 404));
	});
});
