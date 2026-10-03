-- Purchase round-off: the supplier's small adjustment after VAT, plus or
-- minus, at most 5.00 either way ("adjusted amount" on the bill: 124.00 +
-- VAT 6.20 = 130.20, adjusted −0.20, paid 130.00). Outside VAT.
--
-- A purchase can be received in several deliveries, so the round-off is owed
-- — and booked, as its own entry (journal source PURCHASE_ROUNDING) — once
-- the whole purchase is received:
--
--   round-off down (−)    Dr Trade payables / Cr Rounding adjustments
--   round-off up (+)      Dr Rounding adjustments / Cr Trade payables
--
-- The "total = subtotal + VAT" check becomes "total = subtotal + VAT +
-- round-off". Every existing row has a round-off of 0, so every existing row
-- satisfies the new check exactly as it did the old one.
--
-- Additive: one enum value, one column with a default of 0, one check added
-- and one replaced by its extended form. No existing row changes.

-- AlterEnum
ALTER TYPE "JournalSource" ADD VALUE 'PURCHASE_ROUNDING';

-- AlterTable
ALTER TABLE "purchases" ADD COLUMN     "rounding_adjustment" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- The round-off is small, either way.
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_rounding_small" CHECK (rounding_adjustment BETWEEN -5 AND 5);

ALTER TABLE "purchases" DROP CONSTRAINT "purchases_total_is_subtotal_plus_tax";
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_total_is_subtotal_plus_tax"
  CHECK (total_amount IS NULL OR (subtotal >= 0 AND tax_amount >= 0 AND total_amount >= 0
         AND total_amount = subtotal + tax_amount + rounding_adjustment));
