-- Customer advances: money a customer pays before their invoice ("AED 2,000
-- towards the Patrol's repair"), held for them in Customer advances (2030, a
-- liability) until it is applied to their invoices or paid back.
--
--   received   Dr the cash, bank or card account / Cr Customer advances
--   applied    Dr Customer advances / Cr Trade receivables
--   refunded   Dr Customer advances / Cr the account paid from
--
-- Applying an advance settles the invoice like a payment without being one:
-- the invoice's revenue, taxable amount and VAT do not change. What is due
-- becomes total − credited − paid − advance applied; every existing invoice
-- starts at 0 applied, so every existing balance is exactly as before.
--
-- VAT on advances is pending the accountant's confirmation: no VAT is booked
-- on an advance. vat_treatment / vat_rate / vat_amount are there so a
-- confirmed treatment can be switched on later without a redesign.
--
-- Additive only: new tables, new enum values and one new invoice column with
-- a default. No existing row changes.

-- CreateEnum
CREATE TYPE "CustomerAdvanceStatus" AS ENUM ('OPEN', 'PARTIALLY_APPLIED', 'FULLY_APPLIED', 'REFUNDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CustomerAdvanceVatTreatment" AS ENUM ('PENDING_ACCOUNTANT_CONFIRMATION', 'VAT_ON_INVOICE', 'VAT_ON_RECEIPT');

-- AlterEnum
ALTER TYPE "AccountRole" ADD VALUE 'CUSTOMER_ADVANCES';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "JournalSource" ADD VALUE 'CUSTOMER_ADVANCE';
ALTER TYPE "JournalSource" ADD VALUE 'CUSTOMER_ADVANCE_ALLOCATION';
ALTER TYPE "JournalSource" ADD VALUE 'CUSTOMER_ADVANCE_REFUND';

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'CUSTOMER_ADVANCE';

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "advance_applied_amount" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "customer_advances" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "vehicle_id" UUID,
    "job_card_id" UUID,
    "advance_number" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "received_on" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "account_id" UUID,
    "reference" TEXT,
    "notes" TEXT,
    "status" "CustomerAdvanceStatus" NOT NULL DEFAULT 'OPEN',
    "vat_treatment" "CustomerAdvanceVatTreatment" NOT NULL DEFAULT 'PENDING_ACCOUNTANT_CONFIRMATION',
    "vat_rate" DECIMAL(5,2),
    "vat_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cancelled_at" TIMESTAMPTZ,
    "cancel_reason" TEXT,
    "cancelled_by_user_id" UUID,
    "received_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "customer_advances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_advance_allocations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "advance_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "allocated_on" DATE NOT NULL,
    "credit_note_id" UUID,
    "reversed_at" TIMESTAMPTZ,
    "reversal_reason" TEXT,
    "reversed_by_user_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "customer_advance_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_advance_refunds" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "advance_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "refunded_on" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "account_id" UUID,
    "reference" TEXT,
    "notes" TEXT,
    "reversed_at" TIMESTAMPTZ,
    "reversal_reason" TEXT,
    "reversed_by_user_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "customer_advance_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_advances_organization_id_customer_id_idx" ON "customer_advances"("organization_id", "customer_id");

-- CreateIndex
CREATE INDEX "customer_advances_organization_id_job_card_id_idx" ON "customer_advances"("organization_id", "job_card_id");

-- CreateIndex
CREATE INDEX "customer_advances_organization_id_received_on_idx" ON "customer_advances"("organization_id", "received_on");

-- CreateIndex
CREATE UNIQUE INDEX "customer_advances_organization_id_id_key" ON "customer_advances"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_advances_organization_id_advance_number_key" ON "customer_advances"("organization_id", "advance_number");

-- CreateIndex
CREATE INDEX "customer_advance_allocations_organization_id_advance_id_idx" ON "customer_advance_allocations"("organization_id", "advance_id");

-- CreateIndex
CREATE INDEX "customer_advance_allocations_organization_id_invoice_id_idx" ON "customer_advance_allocations"("organization_id", "invoice_id");

-- CreateIndex
CREATE INDEX "customer_advance_allocations_organization_id_credit_note_id_idx" ON "customer_advance_allocations"("organization_id", "credit_note_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_advance_allocations_organization_id_id_key" ON "customer_advance_allocations"("organization_id", "id");

-- CreateIndex
CREATE INDEX "customer_advance_refunds_organization_id_advance_id_idx" ON "customer_advance_refunds"("organization_id", "advance_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_advance_refunds_organization_id_id_key" ON "customer_advance_refunds"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "customer_advances" ADD CONSTRAINT "customer_advances_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_advances" ADD CONSTRAINT "customer_advances_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_advances" ADD CONSTRAINT "customer_advances_organization_id_customer_id_fkey" FOREIGN KEY ("organization_id", "customer_id") REFERENCES "customers"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_advances" ADD CONSTRAINT "customer_advances_organization_id_vehicle_id_fkey" FOREIGN KEY ("organization_id", "vehicle_id") REFERENCES "vehicles"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_advances" ADD CONSTRAINT "customer_advances_organization_id_job_card_id_fkey" FOREIGN KEY ("organization_id", "job_card_id") REFERENCES "job_cards"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_advances" ADD CONSTRAINT "customer_advances_organization_id_account_id_fkey" FOREIGN KEY ("organization_id", "account_id") REFERENCES "chart_of_accounts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_advances" ADD CONSTRAINT "customer_advances_organization_id_received_by_user_id_fkey" FOREIGN KEY ("organization_id", "received_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_advances" ADD CONSTRAINT "customer_advances_organization_id_cancelled_by_user_id_fkey" FOREIGN KEY ("organization_id", "cancelled_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_advance_allocations" ADD CONSTRAINT "customer_advance_allocations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_advance_allocations" ADD CONSTRAINT "customer_advance_allocations_organization_id_advance_id_fkey" FOREIGN KEY ("organization_id", "advance_id") REFERENCES "customer_advances"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_advance_allocations" ADD CONSTRAINT "customer_advance_allocations_organization_id_invoice_id_fkey" FOREIGN KEY ("organization_id", "invoice_id") REFERENCES "invoices"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_advance_allocations" ADD CONSTRAINT "customer_advance_allocations_organization_id_credit_note_i_fkey" FOREIGN KEY ("organization_id", "credit_note_id") REFERENCES "credit_notes"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_advance_allocations" ADD CONSTRAINT "customer_advance_allocations_organization_id_reversed_by_u_fkey" FOREIGN KEY ("organization_id", "reversed_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_advance_allocations" ADD CONSTRAINT "customer_advance_allocations_organization_id_created_by_us_fkey" FOREIGN KEY ("organization_id", "created_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_advance_refunds" ADD CONSTRAINT "customer_advance_refunds_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_advance_refunds" ADD CONSTRAINT "customer_advance_refunds_organization_id_advance_id_fkey" FOREIGN KEY ("organization_id", "advance_id") REFERENCES "customer_advances"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_advance_refunds" ADD CONSTRAINT "customer_advance_refunds_organization_id_account_id_fkey" FOREIGN KEY ("organization_id", "account_id") REFERENCES "chart_of_accounts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_advance_refunds" ADD CONSTRAINT "customer_advance_refunds_organization_id_reversed_by_user__fkey" FOREIGN KEY ("organization_id", "reversed_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_advance_refunds" ADD CONSTRAINT "customer_advance_refunds_organization_id_created_by_user_i_fkey" FOREIGN KEY ("organization_id", "created_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;




-- Amounts are above zero; an invoice's applied amount never below zero. An
-- application row is above zero; a row below zero is money returned to the
-- advance, and only a credit note returns money.
ALTER TABLE "customer_advances" ADD CONSTRAINT "customer_advances_amount_positive" CHECK (amount > 0);
ALTER TABLE "customer_advances" ADD CONSTRAINT "customer_advances_vat_amount_not_negative" CHECK (vat_amount >= 0);
ALTER TABLE "customer_advance_allocations" ADD CONSTRAINT "customer_advance_allocations_amount_not_zero" CHECK (amount <> 0);
ALTER TABLE "customer_advance_allocations" ADD CONSTRAINT "customer_advance_allocations_return_by_credit_note" CHECK ((amount > 0) = (credit_note_id IS NULL));
ALTER TABLE "customer_advance_refunds" ADD CONSTRAINT "customer_advance_refunds_amount_positive" CHECK (amount > 0);
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_advance_applied_not_negative" CHECK (advance_applied_amount >= 0);

-- An advance is never used beyond what was received: its applications (less
-- money returned to it) and refunds still standing add up to no more than
-- its amount, and a cancelled advance has none. Checked when the
-- transaction commits.
CREATE FUNCTION customer_advance_within_amount() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  advance UUID := NEW.advance_id;
  received NUMERIC;
  advance_status "CustomerAdvanceStatus";
  used NUMERIC;
BEGIN
  SELECT amount, status INTO received, advance_status FROM customer_advances WHERE id = advance;
  SELECT
    COALESCE((SELECT SUM(amount) FROM customer_advance_allocations
               WHERE advance_id = advance AND reversed_at IS NULL), 0)
    + COALESCE((SELECT SUM(amount) FROM customer_advance_refunds
                 WHERE advance_id = advance AND reversed_at IS NULL), 0)
    INTO used;
  IF used < 0 THEN
    RAISE EXCEPTION 'Customer advance % would have more returned to it than was applied', advance;
  END IF;
  IF used > received THEN
    RAISE EXCEPTION 'Customer advance % would be used beyond its amount: % of %', advance, used, received;
  END IF;
  IF advance_status = 'CANCELLED' AND used > 0 THEN
    RAISE EXCEPTION 'Customer advance % is cancelled and cannot be used', advance;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER customer_advance_allocations_within_amount
  AFTER INSERT OR UPDATE ON customer_advance_allocations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION customer_advance_within_amount();

CREATE CONSTRAINT TRIGGER customer_advance_refunds_within_amount
  AFTER INSERT OR UPDATE ON customer_advance_refunds
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION customer_advance_within_amount();

-- An invoice's advance_applied_amount always equals the applications still
-- standing against it, and never exceeds what is left of the invoice after
-- credit notes. Checked when the transaction commits.
CREATE FUNCTION invoice_advance_applied_matches() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target UUID;
  recorded NUMERIC;
  invoice_total NUMERIC;
  invoice_credited NUMERIC;
  standing NUMERIC;
BEGIN
  -- Fired from either table: an invoice row, or an application against one.
  IF TG_TABLE_NAME = 'invoices' THEN
    target := NEW.id;
  ELSE
    target := NEW.invoice_id;
  END IF;
  SELECT advance_applied_amount, total_amount, credited_amount
    INTO recorded, invoice_total, invoice_credited
    FROM invoices WHERE id = target;
  SELECT COALESCE(SUM(amount), 0) INTO standing
    FROM customer_advance_allocations
   WHERE invoice_id = target AND reversed_at IS NULL;
  IF recorded <> standing THEN
    RAISE EXCEPTION 'Invoice % records % applied from advances, but % is applied', target, recorded, standing;
  END IF;
  IF standing > invoice_total - invoice_credited THEN
    RAISE EXCEPTION 'Invoice % would have more applied from advances (%) than is left of it (%)', target, standing, invoice_total - invoice_credited;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER customer_advance_allocations_match_invoice
  AFTER INSERT OR UPDATE ON customer_advance_allocations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION invoice_advance_applied_matches();

CREATE CONSTRAINT TRIGGER invoices_advance_applied_matches
  AFTER UPDATE OF advance_applied_amount, credited_amount ON invoices
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION invoice_advance_applied_matches();
