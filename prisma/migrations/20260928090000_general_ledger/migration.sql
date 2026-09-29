-- The general ledger: double-entry books kept by the system.
--
-- Every invoice, customer payment, expense, stock delivery, supplier
-- payment and payroll run is booked as a journal entry by lib/accounting (debits = credits),
-- to accounts found by their role — so a workshop can rename or renumber
-- its accounts freely. Manual entries (an accountant's adjustments, opening
-- balances) are made by hand.
--
-- Where each amount goes can be chosen: an income account on each invoice
-- line, the cash or bank account a payment went into or came out of. Left
-- blank, the default for the line's type or the payment's method is used.
--
-- The books can be closed up to a date; nothing on or before it may then be
-- booked or changed. A VAT return filed with the FTA is recorded, with its
-- settlement, in vat_filings.
--
-- Purely additive: new nullable columns, new tables of nothing. No existing
-- figure changes. Existing records are booked afterwards, from the
-- Accounting screen ("Book existing records").

-- CreateEnum
CREATE TYPE "AccountRole" AS ENUM ('CASH', 'BANK', 'CARD_CLEARING', 'ACCOUNTS_RECEIVABLE', 'INVENTORY', 'VAT_INPUT', 'ACCOUNTS_PAYABLE', 'VAT_OUTPUT', 'OPENING_BALANCE', 'RETAINED_EARNINGS', 'SALES_PARTS', 'SALES_LABOUR', 'SALES_OTHER', 'SALES_DISCOUNTS', 'COST_OF_PARTS', 'STOCK_ADJUSTMENTS', 'OTHER_EXPENSES', 'SALARIES_EXPENSE', 'SALARIES_PAYABLE', 'VAT_SETTLEMENT');

-- CreateEnum
CREATE TYPE "JournalSource" AS ENUM ('INVOICE', 'PAYMENT', 'EXPENSE', 'STOCK_MOVEMENT', 'SUPPLIER_PAYMENT', 'PAYROLL', 'PAYROLL_PAYMENT', 'VAT_FILING', 'VAT_PAYMENT', 'MANUAL');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'JOURNAL_ENTRY';

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "books_closed_through" DATE;

-- AlterTable
ALTER TABLE "invoice_items" ADD COLUMN     "account_id" UUID;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "account_id" UUID;

-- AlterTable
ALTER TABLE "supplier_payments" ADD COLUMN     "account_id" UUID;

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "paid_from_account_id" UUID;

-- AlterTable
ALTER TABLE "chart_of_accounts" ADD COLUMN     "is_payment_account" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "role" "AccountRole";

-- AlterTable
ALTER TABLE "journal_entries" ADD COLUMN     "entry_number" TEXT,
ADD COLUMN     "source_id" UUID,
ADD COLUMN     "source_type" "JournalSource" NOT NULL DEFAULT 'MANUAL';

-- CreateTable
CREATE TABLE "vat_filings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "period_from" DATE NOT NULL,
    "period_to" DATE NOT NULL,
    "standard_supplies" DECIMAL(14,2) NOT NULL,
    "output_vat" DECIMAL(14,2) NOT NULL,
    "zero_rated_supplies" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "standard_expenses" DECIMAL(14,2) NOT NULL,
    "input_vat" DECIMAL(14,2) NOT NULL,
    "net_vat" DECIMAL(14,2) NOT NULL,
    "fta_reference" TEXT,
    "filed_on" DATE NOT NULL,
    "filed_by_user_id" UUID NOT NULL,
    "settled_on" DATE,
    "settled_account_id" UUID,
    "settlement_reference" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "vat_filings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vat_filings_organization_id_period_to_idx" ON "vat_filings"("organization_id", "period_to");

-- CreateIndex
CREATE UNIQUE INDEX "vat_filings_organization_id_id_key" ON "vat_filings"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "vat_filings_organization_id_period_from_period_to_key" ON "vat_filings"("organization_id", "period_from", "period_to");

-- CreateIndex
CREATE UNIQUE INDEX "chart_of_accounts_organization_id_role_key" ON "chart_of_accounts"("organization_id", "role");

-- CreateIndex
CREATE INDEX "journal_entries_organization_id_source_type_source_id_idx" ON "journal_entries"("organization_id", "source_type", "source_id");

-- CreateIndex
CREATE INDEX "journal_entries_organization_id_entry_date_idx" ON "journal_entries"("organization_id", "entry_date");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_organization_id_entry_number_key" ON "journal_entries"("organization_id", "entry_number");

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_organization_id_account_id_fkey" FOREIGN KEY ("organization_id", "account_id") REFERENCES "chart_of_accounts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_account_id_fkey" FOREIGN KEY ("organization_id", "account_id") REFERENCES "chart_of_accounts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_organization_id_account_id_fkey" FOREIGN KEY ("organization_id", "account_id") REFERENCES "chart_of_accounts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_organization_id_paid_from_account_id_fkey" FOREIGN KEY ("organization_id", "paid_from_account_id") REFERENCES "chart_of_accounts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vat_filings" ADD CONSTRAINT "vat_filings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vat_filings" ADD CONSTRAINT "vat_filings_organization_id_filed_by_user_id_fkey" FOREIGN KEY ("organization_id", "filed_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vat_filings" ADD CONSTRAINT "vat_filings_organization_id_settled_account_id_fkey" FOREIGN KEY ("organization_id", "settled_account_id") REFERENCES "chart_of_accounts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A journal line is a debit or a credit — never both, never negative, never
-- nothing.
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_one_side" CHECK (
  debit_amount >= 0
  AND credit_amount >= 0
  AND (debit_amount = 0) <> (credit_amount = 0)
);

-- Every journal entry balances: its debits equal its credits. Checked when
-- the transaction commits, after all of an entry's lines are written.
CREATE FUNCTION journal_entry_must_balance() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  entry UUID := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);
  debits NUMERIC;
  credits NUMERIC;
BEGIN
  SELECT COALESCE(SUM(debit_amount), 0), COALESCE(SUM(credit_amount), 0)
    INTO debits, credits
    FROM journal_entry_lines
   WHERE journal_entry_id = entry;
  IF debits <> credits THEN
    RAISE EXCEPTION 'Journal entry % does not balance: debits %, credits %', entry, debits, credits;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER journal_entry_lines_balance
  AFTER INSERT ON journal_entry_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION journal_entry_must_balance();

-- Booked entries are permanent. A mistake is corrected by a reversing entry,
-- never by editing or deleting what was booked.
CREATE FUNCTION journal_is_permanent() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Journal entries are permanent: reverse an entry instead of changing or deleting it.';
END;
$$;

CREATE TRIGGER journal_entry_lines_permanent
  BEFORE UPDATE OR DELETE ON journal_entry_lines
  FOR EACH ROW EXECUTE FUNCTION journal_is_permanent();

CREATE TRIGGER journal_entries_permanent
  BEFORE DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION journal_is_permanent();
