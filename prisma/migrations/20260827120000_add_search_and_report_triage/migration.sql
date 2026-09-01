-- AUDIT-016: PostgreSQL-maintained full-text index for relevant post search.
ALTER TABLE "posts"
ADD COLUMN "search_vector" tsvector
GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
  setweight(to_tsvector('english', coalesce("content", '')), 'B')
) STORED;

CREATE INDEX "posts_search_vector_idx"
ON "posts" USING GIN ("search_vector");

-- AUDIT-034: reports become an actionable moderation queue.
CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'RESOLVED', 'DISMISSED');

ALTER TABLE "reports"
ADD COLUMN "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "resolved_at" TIMESTAMP(3),
ADD COLUMN "resolved_by_id" TEXT,
ADD COLUMN "resolution_note" TEXT,
ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "comment_reports"
ADD COLUMN "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "resolved_at" TIMESTAMP(3),
ADD COLUMN "resolved_by_id" TEXT,
ADD COLUMN "resolution_note" TEXT,
ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "reports"
ADD CONSTRAINT "reports_resolved_by_id_fkey"
FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "comment_reports"
ADD CONSTRAINT "comment_reports_resolved_by_id_fkey"
FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing deployments may already contain repeated reports because the old
-- write path had no uniqueness guarantee. Keep the newest row before adding
-- the constraints so this additive migration deploys cleanly on real data.
DELETE FROM "reports" older
USING "reports" newer
WHERE older."reporter_id" = newer."reporter_id"
  AND older."post_id" = newer."post_id"
  AND (older."created_at", older."id") < (newer."created_at", newer."id");

DELETE FROM "comment_reports" older
USING "comment_reports" newer
WHERE older."reporter_id" = newer."reporter_id"
  AND older."comment_id" = newer."comment_id"
  AND (older."created_at", older."id") < (newer."created_at", newer."id");

CREATE UNIQUE INDEX "reports_reporter_id_post_id_key"
ON "reports"("reporter_id", "post_id");

CREATE UNIQUE INDEX "comment_reports_reporter_id_comment_id_key"
ON "comment_reports"("reporter_id", "comment_id");

CREATE INDEX "reports_status_created_at_idx"
ON "reports"("status", "created_at" DESC);

CREATE INDEX "comment_reports_status_created_at_idx"
ON "comment_reports"("status", "created_at" DESC);
