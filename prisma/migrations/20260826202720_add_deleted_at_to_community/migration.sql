-- AlterTable
ALTER TABLE "communities" ADD COLUMN     "deleted_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "communities_deleted_at_idx" ON "communities"("deleted_at");
