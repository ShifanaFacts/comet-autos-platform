-- Invoice round-off: a small adjustment after VAT, plus or minus, at most
-- 5.00 either way (e.g. -0.50 to make 3,654.50 into 3,654.00). It is outside
-- VAT and booked to "Rounding adjustments" (account role ROUNDING):
--
--   invoice      Dr Trade receivables   total (VAT and round-off included)
--                Cr / Dr Rounding adjustments   the round-off
--
-- The credit note that credits the last of an invoice's lines takes the
-- round-off back (credit_notes.rounding_amount), so a fully credited invoice
-- comes back to exactly nothing owed.
--
-- The two "total = subtotal + VAT" checks become "total = subtotal + VAT +
-- round-off". Every existing row has a round-off of 0, so every existing row
-- satisfies the new check exactly as it did the old one.
--
-- Additive: one enum value, two columns with a default of 0, and the two
-- checks replaced by their extended form. No existing row changes.

-- AlterEnum
ALTER TYPE "AccountRole" ADD VALUE 'ROUNDING';

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "rounding_adjustment" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "credit_notes" ADD COLUMN     "rounding_amount" DECIMAL(14,2) NOT NULL DEFAULT 0;


-- The round-off is small, either way.
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_rounding_small" CHECK (rounding_adjustment BETWEEN -5 AND 5);
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_rounding_small" CHECK (rounding_amount BETWEEN -5 AND 5);

-- An invoice's total is its subtotal plus VAT plus its round-off; nothing negative.
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_total_is_subtotal_plus_tax";
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_total_is_subtotal_plus_tax"
  CHECK (subtotal >= 0 AND tax_amount >= 0 AND total_amount >= 0
         AND total_amount = subtotal + tax_amount + rounding_adjustment);

-- The same for a credit note, which can take an invoice's round-off back.
ALTER TABLE "credit_notes" DROP CONSTRAINT "credit_notes_amounts_valid";
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_amounts_valid" CHECK (
  subtotal >= 0 AND tax_amount >= 0 AND total_amount >= 0
  AND total_amount = subtotal + tax_amount + rounding_amount
  AND refund_amount >= 0 AND refund_amount <= total_amount
);
