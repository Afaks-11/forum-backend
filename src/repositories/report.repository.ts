import { Prisma, type PrismaClient } from "../generated/prisma/client.js";

export type ReportStatus = "PENDING" | "RESOLVED" | "DISMISSED";

export class ReportRepository {
	constructor(private readonly prisma: PrismaClient) {}

	async create(postId: string, reporterId: string, reason?: string) {
		const rows = await this.prisma.$queryRaw<unknown[]>(Prisma.sql`
			INSERT INTO reports (id, post_id, reporter_id, reason, status, created_at, updated_at)
			VALUES (
				gen_random_uuid()::text,
				${postId},
				${reporterId},
				${reason ?? "Violated community rules guidelines."},
				'PENDING'::"ReportStatus",
				NOW(),
				NOW()
			)
			ON CONFLICT (reporter_id, post_id) DO UPDATE
			SET reason = EXCLUDED.reason,
				status = 'PENDING'::"ReportStatus",
				resolved_at = NULL,
				resolved_by_id = NULL,
				resolution_note = NULL,
				updated_at = NOW()
			RETURNING *
		`);
		return rows[0];
	}

	async createComment(commentId: string, reporterId: string, reason: string) {
		const rows = await this.prisma.$queryRaw<unknown[]>(Prisma.sql`
			INSERT INTO comment_reports
				(id, comment_id, reporter_id, reason, status, created_at, updated_at)
			VALUES (
				gen_random_uuid()::text,
				${commentId},
				${reporterId},
				${reason},
				'PENDING'::"ReportStatus",
				NOW(),
				NOW()
			)
			ON CONFLICT (reporter_id, comment_id) DO UPDATE
			SET reason = EXCLUDED.reason,
				status = 'PENDING'::"ReportStatus",
				resolved_at = NULL,
				resolved_by_id = NULL,
				resolution_note = NULL,
				updated_at = NOW()
			RETURNING *
		`);
		return rows[0];
	}

	async list(
		target: "POST" | "COMMENT",
		status: ReportStatus | undefined,
		limit: number,
		cursor?: string,
	) {
		const table =
			target === "POST" ? Prisma.raw("reports") : Prisma.raw("comment_reports");
		const rows = await this.prisma.$queryRaw<
			Record<string, unknown>[]
		>(Prisma.sql`
			SELECT * FROM ${table}
			WHERE (${status ?? null}::"ReportStatus" IS NULL OR status = ${status ?? null}::"ReportStatus")
				AND (
					${cursor ?? null}::text IS NULL
					OR (created_at, id) < (
						SELECT created_at, id FROM ${table} WHERE id = ${cursor ?? null}
					)
				)
			ORDER BY created_at DESC, id DESC
			LIMIT ${limit + 1}
		`);
		const hasNextPage = rows.length > limit;
		if (hasNextPage) rows.pop();
		const last = rows[rows.length - 1];
		return {
			items: rows,
			nextCursor: hasNextPage && typeof last?.id === "string" ? last.id : null,
		};
	}

	async resolve(
		target: "POST" | "COMMENT",
		id: string,
		resolverId: string,
		status: Exclude<ReportStatus, "PENDING">,
		resolutionNote?: string,
	) {
		const table =
			target === "POST" ? Prisma.raw("reports") : Prisma.raw("comment_reports");
		const rows = await this.prisma.$queryRaw<
			Record<string, unknown>[]
		>(Prisma.sql`
			UPDATE ${table}
			SET status = ${status}::"ReportStatus",
				resolved_by_id = ${resolverId},
				resolved_at = NOW(),
				resolution_note = ${resolutionNote ?? null},
				updated_at = NOW()
			WHERE id = ${id}
			RETURNING *
		`);
		return rows[0] ?? null;
	}
}
