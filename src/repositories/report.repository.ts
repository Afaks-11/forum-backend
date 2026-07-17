import type { PrismaClient } from "../generated/prisma/client.js";

export class ReportRepository {
	constructor(private readonly prisma: PrismaClient) {}

	async create(postId: string, reporterId: string, reason?: string) {
		return await this.prisma.report.create({
			data: {
				postId,
				reporterId,
				reason: reason ?? "Violated community rules guidelines.",
			},
		});
	}
}
