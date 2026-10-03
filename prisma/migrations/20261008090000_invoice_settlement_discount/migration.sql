-- A discount given after an invoice, off its total: "the invoice is 3,654,
-- the customer paid 3,500, the 154 is a discount". No credit note: the
-- invoice keeps its total and VAT exactly as issued (only a tax credit note
-- reduces VAT), and the discount comes off what is owed:
--
--   due = total − credited − settlement discount − advance applied − paid
--
-- Booked as an entry of its own (journal source INVOICE_DISCOUNT), on the day
-- it was given; the invoice's own entry is untouched:
--
--   Dr Sales discounts      the discount
--   Cr Trade receivables    the discount
--
-- Additive: one enum value, two invoice columns (0 / empty by default), one
-- check, and the advance check extended to leave room for the discount.
-- Every existing row has no discount, so every existing row satisfies the
-- checks exactly as before. No existing row changes.

-- AlterEnum
ALTER TYPE "JournalSource" ADD VALUE 'INVOICE_DISCOUNT';

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "settlement_discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "settlement_discount_on" DATE;

-- Never below nothing, never more than is left of the invoice after credit
-- notes, and dated whenever there is one.
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_settlement_discount_valid" CHECK (
  settlement_discount >= 0
  AND credited_amount + settlement_discount <= total_amount
  AND (settlement_discount = 0 OR settlement_discount_on IS NOT NULL)
);

-- Advances applied never exceed what is left of the invoice after credit
-- notes and its discount (was: after credit notes).
CREATE OR REPLACE FUNCTION invoice_advance_applied_matches() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target UUID;
  recorded NUMERIC;
  invoice_total NUMERIC;
  invoice_credited NUMERIC;
  invoice_discount NUMERIC;
  standing NUMERIC;
BEGIN
  -- Fired from either table: an invoice row, or an application against one.
  IF TG_TABLE_NAME = 'invoices' THEN
    target := NEW.id;
  ELSE
    target := NEW.invoice_id;
  END IF;
  SELECT advance_applied_amount, total_amount, credited_amount, settlement_discount
    INTO recorded, invoice_total, invoice_credited, invoice_discount
    FROM invoices WHERE id = target;
  SELECT COALESCE(SUM(amount), 0) INTO standing
    FROM customer_advance_allocations
   WHERE invoice_id = target AND reversed_at IS NULL;
  IF recorded <> standing THEN
    RAISE EXCEPTION 'Invoice % records % applied from advances, but % is applied', target, recorded, standing;
  END IF;
  IF standing > invoice_total - invoice_credited - invoice_discount THEN
    RAISE EXCEPTION 'Invoice % would have more applied from advances (%) than is left of it (%)', target, standing, invoice_total - invoice_credited - invoice_discount;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER "invoices_advance_applied_matches" ON "invoices";
CREATE CONSTRAINT TRIGGER invoices_advance_applied_matches
  AFTER UPDATE OF advance_applied_amount, credited_amount, settlement_discount ON invoices
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION invoice_advance_applied_matches();
