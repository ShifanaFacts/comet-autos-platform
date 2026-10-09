-- Job costing, parts returned on credit notes, and stock counts.
--
--  * An expense can be a cost of one job (a job card, or an invoice billed
--    without one): outside work, towing, materials bought for it. With the
--    parts sold on the invoice, it gives the job's cost and profit.
--  * A credit note line can bring the part back into stock (returned
--    quantity, at the invoice line's cost): a CUSTOMER_RETURN movement
--    linked to the credit note, and its cost off cost of sales.
--  * A stock count is one record; each difference it finds is an adjustment
--    linked to it.
--
-- Nothing already recorded changes: every new column is empty.

-- AlterTable
ALTER TABLE "inventory_transactions" ADD COLUMN     "credit_note_id" UUID,
ADD COLUMN     "stock_count_id" UUID;

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "invoice_id" UUID,
ADD COLUMN     "job_card_id" UUID;

-- AlterTable
ALTER TABLE "credit_note_items" ADD COLUMN     "part_id" UUID,
ADD COLUMN     "returned_quantity" DECIMAL(12,3),
ADD COLUMN     "unit_cost" DECIMAL(14,2);

-- CreateTable
CREATE TABLE "stock_counts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "count_number" TEXT NOT NULL,
    "counted_on" DATE NOT NULL,
    "note" TEXT,
    "parts_counted" INTEGER NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_counts_organization_id_counted_on_idx" ON "stock_counts"("organization_id", "counted_on");

-- CreateIndex
CREATE UNIQUE INDEX "stock_counts_organization_id_id_key" ON "stock_counts"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_counts_organization_id_count_number_key" ON "stock_counts"("organization_id", "count_number");

-- CreateIndex
CREATE INDEX "inventory_transactions_organization_id_credit_note_id_idx" ON "inventory_transactions"("organization_id", "credit_note_id");

-- CreateIndex
CREATE INDEX "inventory_transactions_organization_id_stock_count_id_idx" ON "inventory_transactions"("organization_id", "stock_count_id");

-- CreateIndex
CREATE INDEX "expenses_organization_id_job_card_id_idx" ON "expenses"("organization_id", "job_card_id");

-- CreateIndex
CREATE INDEX "expenses_organization_id_invoice_id_idx" ON "expenses"("organization_id", "invoice_id");

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_organization_id_credit_note_id_fkey" FOREIGN KEY ("organization_id", "credit_note_id") REFERENCES "credit_notes"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_organization_id_stock_count_id_fkey" FOREIGN KEY ("organization_id", "stock_count_id") REFERENCES "stock_counts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_organization_id_created_by_user_id_fkey" FOREIGN KEY ("organization_id", "created_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_organization_id_job_card_id_fkey" FOREIGN KEY ("organization_id", "job_card_id") REFERENCES "job_cards"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_organization_id_invoice_id_fkey" FOREIGN KEY ("organization_id", "invoice_id") REFERENCES "invoices"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_items" ADD CONSTRAINT "credit_note_items_organization_id_part_id_fkey" FOREIGN KEY ("organization_id", "part_id") REFERENCES "parts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A job cost belongs to a job card or to an invoice, not both.
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_one_job" CHECK ("job_card_id" IS NULL OR "invoice_id" IS NULL);

-- What comes back is never negative.
ALTER TABLE "credit_note_items" ADD CONSTRAINT "credit_note_items_returned_not_negative" CHECK ("returned_quantity" IS NULL OR "returned_quantity" >= 0);
ALTER TABLE "credit_note_items" ADD CONSTRAINT "credit_note_items_unit_cost_not_negative" CHECK ("unit_cost" IS NULL OR "unit_cost" >= 0);
