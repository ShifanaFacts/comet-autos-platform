-- A supplier's TRN, so a scanned bill can find its supplier; and the
-- supplier's own bill number on an expense, so the same bill entered twice
-- can be spotted. Both optional: nothing already recorded changes.
ALTER TABLE "suppliers" ADD COLUMN "tax_number" TEXT;
ALTER TABLE "expenses" ADD COLUMN "bill_number" TEXT;

CREATE INDEX "suppliers_organization_id_tax_number_idx" ON "suppliers"("organization_id", "tax_number");
