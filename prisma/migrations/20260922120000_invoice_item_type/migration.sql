-- Invoice lines remember whether they are parts or labour, so the printed
-- invoice can show a TYPE column like the workshop's own quotation sheet.
--
-- Purely additive and label-only: one nullable column; no total, VAT or
-- balance reads it. Reuses the type quotation lines already carry.

ALTER TABLE "invoice_items" ADD COLUMN "item_type" "EstimateItemType";

-- Lines billed from the repair records already say what they are.
UPDATE "invoice_items" SET "item_type" = 'LABOUR' WHERE "labour_id" IS NOT NULL;
UPDATE "invoice_items" SET "item_type" = 'PART' WHERE "part_usage_id" IS NOT NULL;
