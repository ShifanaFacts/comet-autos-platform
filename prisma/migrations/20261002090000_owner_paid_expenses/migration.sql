-- Expenses an owner or partner paid with their own money, and repaying them.
-- Additive only: one nullable column, one new table, two new enum values.

-- AlterEnum
ALTER TYPE "AccountRole" ADD VALUE 'OWNER_CURRENT';

-- AlterEnum
ALTER TYPE "JournalSource" ADD VALUE 'OWNER_REIMBURSEMENT';

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "paid_by_person_user_id" UUID;

-- CreateTable
CREATE TABLE "owner_reimbursements" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "person_user_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'COMPLETED',
    "paid_from_account_id" UUID,
    "note" TEXT,
    "reversal_of_id" UUID,
    "paid_on" DATE NOT NULL,
    "recorded_by_user_id" UUID NOT NULL,
    "journal_entry_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "owner_reimbursements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "owner_reimbursements_organization_id_person_user_id_idx" ON "owner_reimbursements"("organization_id", "person_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "owner_reimbursements_organization_id_id_key" ON "owner_reimbursements"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "owner_reimbursements_reversal_of_id_key" ON "owner_reimbursements"("reversal_of_id");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_organization_id_paid_by_person_user_id_fkey" FOREIGN KEY ("organization_id", "paid_by_person_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_reimbursements" ADD CONSTRAINT "owner_reimbursements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_reimbursements" ADD CONSTRAINT "owner_reimbursements_organization_id_person_user_id_fkey" FOREIGN KEY ("organization_id", "person_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_reimbursements" ADD CONSTRAINT "owner_reimbursements_organization_id_recorded_by_user_id_fkey" FOREIGN KEY ("organization_id", "recorded_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_reimbursements" ADD CONSTRAINT "owner_reimbursements_organization_id_paid_from_account_id_fkey" FOREIGN KEY ("organization_id", "paid_from_account_id") REFERENCES "chart_of_accounts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_reimbursements" ADD CONSTRAINT "owner_reimbursements_organization_id_reversal_of_id_fkey" FOREIGN KEY ("organization_id", "reversal_of_id") REFERENCES "owner_reimbursements"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_reimbursements" ADD CONSTRAINT "owner_reimbursements_organization_id_journal_entry_id_fkey" FOREIGN KEY ("organization_id", "journal_entry_id") REFERENCES "journal_entries"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
