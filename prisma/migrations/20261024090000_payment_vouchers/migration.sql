-- Payment vouchers, and what the bank keeps on a card settlement.
--
--  * A payment voucher (PV-) is money paid out to someone, on paper they
--    sign for it:
--      - card collection: someone else's customer paid on the workshop's
--        card machine (an outside upholsterer without one). The money is
--        theirs — owed to them in "Money collected for others" — and is
--        paid over less what the bank kept for it;
--      - outside work: an outside mechanic or a sublet repair, recorded as an
--        expense so it counts in the job's cost.
--  * A money transfer can say what the bank kept on the way (its fee, and
--    the VAT on it): card money paid into the bank arrives less the card
--    machine's fee, and that fee is a bank charge.
--  * Two account roles: the standard chart's "Bank charges" (5190) is
--    adopted for BANK_CHARGES, and "Money collected for others" (2040) is
--    added, the next time anything is booked (lib/accounting/chart.ts).
--
-- Purely additive: nothing already recorded changes. Every transfer keeps
-- charges of 0, so its entry stays exactly as booked.

-- CreateEnum
CREATE TYPE "PaymentVoucherKind" AS ENUM ('CARD_COLLECTION', 'WORK');

-- CreateEnum
CREATE TYPE "PaymentVoucherStatus" AS ENUM ('OWED', 'PAID', 'VOID');

-- AlterEnum
ALTER TYPE "AccountRole" ADD VALUE IF NOT EXISTS 'BANK_CHARGES';
ALTER TYPE "AccountRole" ADD VALUE IF NOT EXISTS 'MONEY_HELD_FOR_OTHERS';

-- AlterEnum
ALTER TYPE "JournalSource" ADD VALUE IF NOT EXISTS 'CARD_COLLECTION';
ALTER TYPE "JournalSource" ADD VALUE IF NOT EXISTS 'PAYMENT_VOUCHER';

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'PAYMENT_VOUCHER';

-- AlterTable
ALTER TABLE "money_transfers" ADD COLUMN     "charges_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "charges_vat_amount" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- What the bank kept is never negative.
ALTER TABLE "money_transfers" ADD CONSTRAINT "money_transfers_charges_not_negative"
  CHECK ("charges_amount" >= 0 AND "charges_vat_amount" >= 0);

-- CreateTable
CREATE TABLE "payment_vouchers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "voucher_number" TEXT NOT NULL,
    "kind" "PaymentVoucherKind" NOT NULL,
    "status" "PaymentVoucherStatus" NOT NULL DEFAULT 'PAID',
    "payee_name" TEXT NOT NULL,
    "payee_phone" TEXT,
    "description" TEXT NOT NULL,
    "collected_on" DATE,
    "collected_amount" DECIMAL(14,2),
    "card_account_id" UUID,
    "card_reference" TEXT,
    "fee_rate" DECIMAL(5,2),
    "fee_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "fee_vat_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(14,2),
    "paid_on" DATE,
    "payment_method" "PaymentMethod",
    "paid_from_account_id" UUID,
    "payment_reference" TEXT,
    "expense_id" UUID,
    "notes" TEXT,
    "voided_at" TIMESTAMPTZ,
    "void_reason" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payment_vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_vouchers_organization_id_status_idx" ON "payment_vouchers"("organization_id", "status");

-- CreateIndex
CREATE INDEX "payment_vouchers_organization_id_paid_on_idx" ON "payment_vouchers"("organization_id", "paid_on");

-- CreateIndex
CREATE UNIQUE INDEX "payment_vouchers_organization_id_id_key" ON "payment_vouchers"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_vouchers_organization_id_voucher_number_key" ON "payment_vouchers"("organization_id", "voucher_number");

-- CreateIndex
CREATE UNIQUE INDEX "payment_vouchers_organization_id_expense_id_key" ON "payment_vouchers"("organization_id", "expense_id");

-- AddForeignKey
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_organization_id_card_account_id_fkey" FOREIGN KEY ("organization_id", "card_account_id") REFERENCES "chart_of_accounts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_organization_id_paid_from_account_id_fkey" FOREIGN KEY ("organization_id", "paid_from_account_id") REFERENCES "chart_of_accounts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_organization_id_expense_id_fkey" FOREIGN KEY ("organization_id", "expense_id") REFERENCES "expenses"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_organization_id_created_by_user_id_fkey" FOREIGN KEY ("organization_id", "created_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The figures on a voucher always agree with each other.
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_amounts_not_negative"
  CHECK ("fee_amount" >= 0 AND "fee_vat_amount" >= 0
     AND ("amount" IS NULL OR "amount" >= 0)
     AND ("collected_amount" IS NULL OR "collected_amount" > 0));

-- A card collection says when, how much and into which card account; once
-- paid over, what was handed over plus the bank's fee and its VAT is exactly
-- what was collected.
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_card_collection_complete"
  CHECK ("kind" <> 'CARD_COLLECTION'
     OR ("collected_on" IS NOT NULL AND "collected_amount" IS NOT NULL AND "card_account_id" IS NOT NULL
         AND ("amount" IS NULL OR "amount" + "fee_amount" + "fee_vat_amount" = "collected_amount")));

-- Outside work is paid when it is recorded, through its expense.
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_work_has_expense"
  CHECK ("kind" <> 'WORK' OR ("expense_id" IS NOT NULL AND "status" <> 'OWED'));

-- Paid means an amount and a day; owed means neither yet.
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_paid_has_amount"
  CHECK ("status" <> 'PAID' OR ("amount" IS NOT NULL AND "paid_on" IS NOT NULL));
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_owed_not_paid"
  CHECK ("status" <> 'OWED' OR ("amount" IS NULL AND "paid_on" IS NULL));

-- Booked the moment they are recorded: like every money document, never
-- deleted — voided instead (20261018090000_booked_documents_permanent).
CREATE TRIGGER payment_vouchers_booked_permanent
  BEFORE DELETE ON "payment_vouchers"
  FOR EACH ROW EXECUTE FUNCTION booked_document_is_permanent('payment voucher');
CREATE TRIGGER payment_vouchers_no_truncate BEFORE TRUNCATE ON "payment_vouchers"
  FOR EACH STATEMENT EXECUTE FUNCTION booked_documents_no_truncate();
