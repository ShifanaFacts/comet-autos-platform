-- Invoicing, payments and delivery. Additive only: new nullable columns, one
-- partial unique index, one foreign key and CHECK constraints. Existing rows
-- are not modified. One explicit transaction (Prisma does not wrap
-- migration scripts).
BEGIN;

-- AlterTable: delivery (handover) record on the job card
ALTER TABLE "job_cards" ADD COLUMN     "delivered_at" TIMESTAMPTZ,
ADD COLUMN     "delivered_by_user_id" UUID,
ADD COLUMN     "delivery_notes" TEXT;

-- AlterTable: free-text notes on a payment (reference stays in reference_number)
ALTER TABLE "payments" ADD COLUMN     "notes" TEXT;

-- CreateIndex: a job card has at most one live invoice
CREATE UNIQUE INDEX "one_live_invoice_per_job_card" ON "invoices"("job_card_id") WHERE (job_card_id IS NOT NULL AND status NOT IN ('VOID', 'CANCELLED'));

-- AddForeignKey
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_organization_id_delivered_by_user_id_fkey" FOREIGN KEY ("organization_id", "delivered_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Integrity rules Prisma cannot express natively.
-- Money received is always positive (reversals are separate rows, per the Payment model).
ALTER TABLE "payments" ADD CONSTRAINT "payments_positive_amount" CHECK (amount > 0);

-- An invoice's total is its subtotal plus VAT, all non-negative.
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_total_is_subtotal_plus_tax"
  CHECK (subtotal >= 0 AND tax_amount >= 0 AND total_amount = subtotal + tax_amount);

-- A delivery is recorded with both who and when, or not at all.
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_delivery_complete"
  CHECK ((delivered_at IS NULL) = (delivered_by_user_id IS NULL));

COMMIT;
