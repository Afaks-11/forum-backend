-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "lock_set_by_id" TEXT,
ALTER COLUMN "community_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_lock_set_by_id_fkey" FOREIGN KEY ("lock_set_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
