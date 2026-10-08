-- Controlled parts, stock and cost of sales.
--
--  * An invoice's PART line names the catalogue part it sells (part_id) and
--    what it cost (unit_cost). Its stock leaves on issue as SALE movements
--    linked to the invoice (invoice_id); its cost is booked on the
--    invoice's own entry.
--  * A purchase records the supplier's tax invoice: still to come, matched,
--    or never coming. Input VAT waits in "Input VAT — awaiting tax invoice"
--    until it is matched, and is claimed on the day the bill was received.
--
-- Every purchase already recorded is marked RECEIVED, dated on its bill (or
-- the day it was received), so nothing already in the books changes.

-- CreateEnum
CREATE TYPE "PurchaseBillStatus" AS ENUM ('PENDING', 'RECEIVED', 'NO_TAX_INVOICE');

-- AlterEnum
ALTER TYPE "AccountRole" ADD VALUE 'VAT_INPUT_PENDING';

-- AlterEnum
ALTER TYPE "InventoryTransactionType" ADD VALUE 'SALE';

-- AlterEnum
ALTER TYPE "JournalSource" ADD VALUE 'PURCHASE_BILL';

-- AlterTable
ALTER TABLE "inventory_transactions" ADD COLUMN     "invoice_id" UUID;

-- AlterTable
ALTER TABLE "invoice_items" ADD COLUMN     "part_id" UUID,
ADD COLUMN     "unit_cost" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "purchases" ADD COLUMN     "bill_matched_by_user_id" UUID,
ADD COLUMN     "bill_note" TEXT,
ADD COLUMN     "bill_received_on" DATE,
ADD COLUMN     "bill_status" "PurchaseBillStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "bill_subtotal" DECIMAL(14,2),
ADD COLUMN     "bill_tax_amount" DECIMAL(14,2),
ADD COLUMN     "bill_total_amount" DECIMAL(14,2);

-- CreateIndex
CREATE INDEX "inventory_transactions_organization_id_invoice_id_idx" ON "inventory_transactions"("organization_id", "invoice_id");

-- CreateIndex
CREATE INDEX "invoice_items_organization_id_part_id_idx" ON "invoice_items"("organization_id", "part_id");

-- CreateIndex
CREATE INDEX "purchases_organization_id_bill_status_idx" ON "purchases"("organization_id", "bill_status");

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_organization_id_bill_matched_by_user_id_fkey" FOREIGN KEY ("organization_id", "bill_matched_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_organization_id_invoice_id_fkey" FOREIGN KEY ("organization_id", "invoice_id") REFERENCES "invoices"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_organization_id_part_id_fkey" FOREIGN KEY ("organization_id", "part_id") REFERENCES "parts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- What was recorded before this change keeps exactly its booking.
UPDATE "purchases"
SET "bill_status" = 'RECEIVED',
    "bill_received_on" = COALESCE("supplier_invoice_date", ("received_at" AT TIME ZONE 'Asia/Dubai')::date, ("ordered_at" AT TIME ZONE 'Asia/Dubai')::date);

-- A part sold on an invoice line has a non-negative cost.
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_unit_cost_not_negative" CHECK ("unit_cost" IS NULL OR "unit_cost" >= 0);
