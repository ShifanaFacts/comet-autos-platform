-- Customer and supplier sub-ledgers on journal entries.
--
-- An account can be kept per customer or per supplier (its sub-ledger).
-- Trade receivables and trade payables always are; the accountant may keep
-- any other asset or liability account that way too (other receivables,
-- supplier advances…). Every manual journal line on such an account names
-- the customer or supplier it is for, so the amount counts in that party's
-- balance and statement, and the parties' balances still add up to the
-- account.
--
-- Purely additive: one enum, three nullable columns, two foreign keys, two
-- indexes, two checks and one trigger. No row changes; existing entries
-- stay exactly as booked.

-- CreateEnum
CREATE TYPE "PartyType" AS ENUM ('CUSTOMER', 'SUPPLIER');

-- AlterTable
ALTER TABLE "chart_of_accounts" ADD COLUMN "sub_ledger" "PartyType";

-- AlterTable
ALTER TABLE "journal_entry_lines" ADD COLUMN "customer_id" UUID,
ADD COLUMN "supplier_id" UUID;

-- CreateIndex
CREATE INDEX "journal_entry_lines_organization_id_customer_id_idx" ON "journal_entry_lines"("organization_id", "customer_id");

-- CreateIndex
CREATE INDEX "journal_entry_lines_organization_id_supplier_id_idx" ON "journal_entry_lines"("organization_id", "supplier_id");

-- AddForeignKey: a party of the same organization, which can't be removed while it has entries.
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_customer_fkey" FOREIGN KEY ("organization_id", "customer_id") REFERENCES "customers"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_supplier_fkey" FOREIGN KEY ("organization_id", "supplier_id") REFERENCES "suppliers"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A line is for one party at most.
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_one_party"
  CHECK (customer_id IS NULL OR supplier_id IS NULL);

-- Only balance-sheet accounts that are owed or owing are kept per party.
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_sub_ledger_type"
  CHECK (sub_ledger IS NULL OR account_type IN ('ASSET', 'LIABILITY'));

-- The rule the app follows, enforced where nothing can skip it: a manual
-- line on an account kept per party names a party of that kind, and no line
-- names a party on an account that isn't kept that way. Postings made from a
-- document (an invoice, a purchase…) are kept per party by the document
-- itself, so they are left as they are.
CREATE FUNCTION journal_line_party_matches_account() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  kept "PartyType";
  manual boolean;
BEGIN
  SELECT COALESCE(
           a.sub_ledger,
           CASE a.role
             WHEN 'ACCOUNTS_RECEIVABLE' THEN 'CUSTOMER'::"PartyType"
             WHEN 'ACCOUNTS_PAYABLE' THEN 'SUPPLIER'::"PartyType"
           END
         )
    INTO kept
    FROM chart_of_accounts a
   WHERE a.id = NEW.chart_of_account_id;

  IF NEW.customer_id IS NOT NULL AND kept IS DISTINCT FROM 'CUSTOMER' THEN
    RAISE EXCEPTION 'A customer can only be named on an account kept per customer.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.supplier_id IS NOT NULL AND kept IS DISTINCT FROM 'SUPPLIER' THEN
    RAISE EXCEPTION 'A supplier can only be named on an account kept per supplier.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- A reversal copies its original line for line — including an entry made
  -- before parties were kept, which named none — so only new entries are held
  -- to the rule.
  SELECT e.source_type = 'MANUAL' AND e.reversal_of_journal_entry_id IS NULL INTO manual
    FROM journal_entries e
   WHERE e.id = NEW.journal_entry_id;
  IF manual AND kept = 'CUSTOMER' AND NEW.customer_id IS NULL THEN
    RAISE EXCEPTION 'Every manual line on a customer account must name the customer.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF manual AND kept = 'SUPPLIER' AND NEW.supplier_id IS NULL THEN
    RAISE EXCEPTION 'Every manual line on a supplier account must name the supplier.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER journal_entry_lines_party_matches_account
  BEFORE INSERT ON "journal_entry_lines"
  FOR EACH ROW EXECUTE FUNCTION journal_line_party_matches_account();
