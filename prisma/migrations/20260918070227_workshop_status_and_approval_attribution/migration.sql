-- AlterEnum
ALTER TYPE "ApprovalMethod" ADD VALUE 'ONLINE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "JobCardStatus" ADD VALUE 'ARRIVED';
ALTER TYPE "JobCardStatus" ADD VALUE 'INSPECTION';
ALTER TYPE "JobCardStatus" ADD VALUE 'DIAGNOSIS';
ALTER TYPE "JobCardStatus" ADD VALUE 'ESTIMATE';
ALTER TYPE "JobCardStatus" ADD VALUE 'WAITING_APPROVAL';
ALTER TYPE "JobCardStatus" ADD VALUE 'REJECTED';
ALTER TYPE "JobCardStatus" ADD VALUE 'REPAIR';
ALTER TYPE "JobCardStatus" ADD VALUE 'QUALITY_CHECK';
ALTER TYPE "JobCardStatus" ADD VALUE 'READY';
ALTER TYPE "JobCardStatus" ADD VALUE 'PAID';
ALTER TYPE "JobCardStatus" ADD VALUE 'DELIVERED';

-- AlterTable
ALTER TABLE "approvals" ADD COLUMN     "customer_id" UUID,
ADD COLUMN     "decided_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "recorded_by_user_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "job_status_history" ADD COLUMN     "changed_by_customer_id" UUID,
ALTER COLUMN "changed_by_user_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "approvals_organization_id_customer_id_idx" ON "approvals"("organization_id", "customer_id");

-- AddForeignKey
ALTER TABLE "job_status_history" ADD CONSTRAINT "job_status_history_organization_id_changed_by_customer_id_fkey" FOREIGN KEY ("organization_id", "changed_by_customer_id") REFERENCES "customers"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_organization_id_customer_id_fkey" FOREIGN KEY ("organization_id", "customer_id") REFERENCES "customers"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
