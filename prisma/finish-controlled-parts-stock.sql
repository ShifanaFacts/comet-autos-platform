-- Finishes migration 20261020090000_controlled_parts_stock, which stopped
-- part-way on the hosted database: its enums, columns and first index were
-- created; the rest below was not. Safe to run more than once — every step
-- checks first. Run it whole (Supabase SQL editor), then mark the migration
-- applied:
--
--   npx prisma migrate resolve --applied 20261020090000_controlled_parts_stock --schema=./prisma/schema.prisma

BEGIN;

CREATE INDEX IF NOT EXISTS "inventory_transactions_organization_id_invoice_id_idx" ON "inventory_transactions"("organization_id", "invoice_id");
CREATE INDEX IF NOT EXISTS "invoice_items_organization_id_part_id_idx" ON "invoice_items"("organization_id", "part_id");
CREATE INDEX IF NOT EXISTS "purchases_organization_id_bill_status_idx" ON "purchases"("organization_id", "bill_status");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchases_organization_id_bill_matched_by_user_id_fkey') THEN
    ALTER TABLE "purchases" ADD CONSTRAINT "purchases_organization_id_bill_matched_by_user_id_fkey" FOREIGN KEY ("organization_id", "bill_matched_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_transactions_organization_id_invoice_id_fkey') THEN
    ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_organization_id_invoice_id_fkey" FOREIGN KEY ("organization_id", "invoice_id") REFERENCES "invoices"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_items_organization_id_part_id_fkey') THEN
    ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_organization_id_part_id_fkey" FOREIGN KEY ("organization_id", "part_id") REFERENCES "parts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_items_unit_cost_not_negative') THEN
    ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_unit_cost_not_negative" CHECK ("unit_cost" IS NULL OR "unit_cost" >= 0);
  END IF;
END $$;

-- Every purchase recorded before the change keeps exactly its booking: its
-- bill counts as in hand, dated on the bill (or the day it was received).
-- Only rows never given a bill date are touched.
UPDATE "purchases"
SET "bill_status" = 'RECEIVED',
    "bill_received_on" = COALESCE("supplier_invoice_date", ("received_at" AT TIME ZONE 'Asia/Dubai')::date, ("ordered_at" AT TIME ZONE 'Asia/Dubai')::date)
WHERE "bill_received_on" IS NULL AND "bill_matched_by_user_id" IS NULL
  AND "created_at" < TIMESTAMPTZ '2026-10-07 21:59:47+00';

-- What it should show: every older purchase RECEIVED and dated.
SELECT "bill_status", COUNT(*) AS purchases, COUNT("bill_received_on") AS dated FROM "purchases" GROUP BY 1;

COMMIT;
