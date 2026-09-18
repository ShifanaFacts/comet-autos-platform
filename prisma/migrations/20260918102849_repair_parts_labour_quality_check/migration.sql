-- Repair milestone: estimate kind (additional work), links from labour and
-- parts used to the approved estimate line, and the QualityCheck history
-- table. Additive only: no existing column is changed or dropped. Existing
-- estimates become kind ORIGINAL. One explicit transaction (Prisma does not
-- wrap migration scripts).
BEGIN;

-- CreateEnum
CREATE TYPE "EstimateKind" AS ENUM ('ORIGINAL', 'ADDITIONAL');

-- CreateEnum
CREATE TYPE "QualityCheckStatus" AS ENUM ('PASSED', 'FAILED');

-- AlterTable
ALTER TABLE "estimates" ADD COLUMN     "kind" "EstimateKind" NOT NULL DEFAULT 'ORIGINAL',
ADD COLUMN     "notes" TEXT;

-- AlterTable
ALTER TABLE "labours" ADD COLUMN     "estimate_item_id" UUID;

-- AlterTable
ALTER TABLE "part_usages" ADD COLUMN     "estimate_item_id" UUID;

-- CreateTable
CREATE TABLE "quality_checks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "job_card_id" UUID NOT NULL,
    "checked_by_employee_id" UUID NOT NULL,
    "recorded_by_user_id" UUID NOT NULL,
    "status" "QualityCheckStatus" NOT NULL,
    "notes" TEXT,
    "corrections_required" TEXT,
    "checked_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "quality_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quality_checks_organization_id_idx" ON "quality_checks"("organization_id");

-- CreateIndex
CREATE INDEX "quality_checks_organization_id_job_card_id_checked_at_idx" ON "quality_checks"("organization_id", "job_card_id", "checked_at");

-- CreateIndex
CREATE INDEX "quality_checks_organization_id_checked_by_employee_id_idx" ON "quality_checks"("organization_id", "checked_by_employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "quality_checks_organization_id_id_key" ON "quality_checks"("organization_id", "id");

-- CreateIndex
CREATE INDEX "estimates_organization_id_job_card_id_kind_idx" ON "estimates"("organization_id", "job_card_id", "kind");

-- CreateIndex
CREATE INDEX "labours_organization_id_estimate_item_id_idx" ON "labours"("organization_id", "estimate_item_id");

-- CreateIndex
CREATE INDEX "part_usages_organization_id_estimate_item_id_idx" ON "part_usages"("organization_id", "estimate_item_id");

-- AddForeignKey
ALTER TABLE "labours" ADD CONSTRAINT "labours_organization_id_estimate_item_id_fkey" FOREIGN KEY ("organization_id", "estimate_item_id") REFERENCES "estimate_items"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_usages" ADD CONSTRAINT "part_usages_organization_id_estimate_item_id_fkey" FOREIGN KEY ("organization_id", "estimate_item_id") REFERENCES "estimate_items"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_checks" ADD CONSTRAINT "quality_checks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_checks" ADD CONSTRAINT "quality_checks_organization_id_job_card_id_fkey" FOREIGN KEY ("organization_id", "job_card_id") REFERENCES "job_cards"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_checks" ADD CONSTRAINT "quality_checks_organization_id_checked_by_employee_id_fkey" FOREIGN KEY ("organization_id", "checked_by_employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_checks" ADD CONSTRAINT "quality_checks_organization_id_recorded_by_user_id_fkey" FOREIGN KEY ("organization_id", "recorded_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Integrity rules Prisma cannot express natively.
-- A failed quality check must say what has to be corrected.
ALTER TABLE "quality_checks" ADD CONSTRAINT "quality_checks_failed_needs_corrections"
  CHECK (status <> 'FAILED' OR length(btrim(coalesce(corrections_required, ''))) > 0);

-- Parts used and labour are always positive quantities at non-negative prices.
ALTER TABLE "part_usages" ADD CONSTRAINT "part_usages_positive_quantity"
  CHECK (quantity > 0 AND unit_cost >= 0 AND unit_price >= 0);
ALTER TABLE "labours" ADD CONSTRAINT "labours_positive_hours"
  CHECK (hours > 0 AND rate >= 0 AND amount >= 0);

-- A job consumption is always a stock-out: a negative ledger quantity.
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_job_consumption_is_stock_out"
  CHECK (transaction_type <> 'JOB_CONSUMPTION' OR quantity < 0);

COMMIT;
