-- Expenses & bills as a module of their own: what an accountant checks on
-- each one. All optional, so every expense already recorded stays as it is.
--
--   supplier_trn        the supplier's TRN on their tax invoice (needed to
--                       reclaim the VAT on it)
--   due_date            for a bill not yet paid: when it is due
--   payment_reference   the transfer, cheque or card-slip number it was paid with
--   notes               anything else worth keeping with it

ALTER TABLE "expenses" ADD COLUMN "supplier_trn" TEXT;
ALTER TABLE "expenses" ADD COLUMN "due_date" DATE;
ALTER TABLE "expenses" ADD COLUMN "payment_reference" TEXT;
ALTER TABLE "expenses" ADD COLUMN "notes" TEXT;
