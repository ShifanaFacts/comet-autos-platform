-- Opening balances and year-end closing.
--
-- Additive only: new values on existing enums. Nothing is changed or
-- removed, and no existing row is touched.

-- Journal entries that bring in opening balances, and year-end closing entries.
ALTER TYPE "JournalSource" ADD VALUE 'OPENING_BALANCE';
ALTER TYPE "JournalSource" ADD VALUE 'YEAR_END_CLOSE';

-- A customer's balance brought forward from before the books began.
ALTER TYPE "InvoiceType" ADD VALUE 'OPENING_BALANCE';

-- Its number sequence (OB-000001).
ALTER TYPE "DocumentType" ADD VALUE 'OPENING_BALANCE';

-- The date the books begin; every opening balance is booked on it.
ALTER TABLE "organizations" ADD COLUMN "opening_balance_date" DATE;
