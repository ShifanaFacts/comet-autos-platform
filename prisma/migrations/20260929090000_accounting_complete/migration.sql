-- Completing the books: VAT treatments, tax credit notes, bank
-- reconciliation, fixed assets with depreciation, and supplier bills kept
-- against expenses.
--
--   * Each quotation and invoice line has a VAT treatment (standard,
--     zero-rated, exempt, out of scope); its rate follows from it. The
--     workshop's emirate (Dubai by default) labels VAT201 Box 1.
--   * credit_notes: tax credit notes (CN-) against invoices, with any refund.
--   * bank_reconciliations / reconciled_lines: statement matching.
--   * fixed_assets / asset_depreciations: the asset register and each
--     month's depreciation.
--
-- Additive, with one data step: lines already charged at 0% are marked
-- ZERO_RATED — exactly how the VAT return already reports them — so every
-- existing figure stays the same.

-- CreateEnum
CREATE TYPE "VatTreatment" AS ENUM ('STANDARD', 'ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE');

-- CreateEnum
CREATE TYPE "Emirate" AS ENUM ('ABU_DHABI', 'DUBAI', 'SHARJAH', 'AJMAN', 'UMM_AL_QUWAIN', 'RAS_AL_KHAIMAH', 'FUJAIRAH');

-- CreateEnum
CREATE TYPE "CreditNoteStatus" AS ENUM ('ISSUED', 'VOID');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "AssetFunding" AS ENUM ('PAID', 'ON_CREDIT', 'OPENING');

-- CreateEnum
CREATE TYPE "FixedAssetStatus" AS ENUM ('ACTIVE', 'DISPOSED');

-- AlterEnum
ALTER TYPE "AccountRole" ADD VALUE 'ASSET_DISPOSALS';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "JournalSource" ADD VALUE 'CREDIT_NOTE';
ALTER TYPE "JournalSource" ADD VALUE 'CREDIT_NOTE_REFUND';
ALTER TYPE "JournalSource" ADD VALUE 'FIXED_ASSET';
ALTER TYPE "JournalSource" ADD VALUE 'DEPRECIATION';
ALTER TYPE "JournalSource" ADD VALUE 'ASSET_DISPOSAL';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DocumentType" ADD VALUE 'CREDIT_NOTE';
ALTER TYPE "DocumentType" ADD VALUE 'FIXED_ASSET';

-- AlterEnum
ALTER TYPE "DocumentCategory" ADD VALUE 'SUPPLIER_BILL';

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "emirate" "Emirate" NOT NULL DEFAULT 'DUBAI';

-- AlterTable
ALTER TABLE "estimate_items" ADD COLUMN     "vat_treatment" "VatTreatment" NOT NULL DEFAULT 'STANDARD';

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "credited_amount" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "invoice_items" ADD COLUMN     "vat_treatment" "VatTreatment" NOT NULL DEFAULT 'STANDARD';

-- CreateTable
CREATE TABLE "credit_notes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "credit_note_number" TEXT NOT NULL,
    "status" "CreditNoteStatus" NOT NULL DEFAULT 'ISSUED',
    "issue_date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "discount_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "tax_amount" DECIMAL(14,2) NOT NULL,
    "total_amount" DECIMAL(14,2) NOT NULL,
    "refund_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "refunded_on" DATE,
    "refund_method" "PaymentMethod",
    "refund_account_id" UUID,
    "refund_reference" TEXT,
    "voided_at" TIMESTAMPTZ,
    "void_reason" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_note_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "credit_note_id" UUID NOT NULL,
    "invoice_item_id" UUID,
    "item_type" "EstimateItemType",
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit_price" DECIMAL(14,2) NOT NULL,
    "line_total" DECIMAL(14,2) NOT NULL,
    "discount_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vat_treatment" "VatTreatment" NOT NULL DEFAULT 'STANDARD',
    "tax_rate" DECIMAL(5,2) NOT NULL,
    "tax_amount" DECIMAL(14,2) NOT NULL,
    "account_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_note_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_reconciliations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "statement_date" DATE NOT NULL,
    "statement_balance" DECIMAL(14,2) NOT NULL,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "completed_at" TIMESTAMPTZ,
    "completed_by_user_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "bank_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciled_lines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "reconciliation_id" UUID NOT NULL,
    "journal_entry_line_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciled_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_assets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "asset_number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "asset_account_id" UUID NOT NULL,
    "accumulated_account_id" UUID NOT NULL,
    "expense_account_id" UUID NOT NULL,
    "acquired_on" DATE NOT NULL,
    "cost" DECIMAL(14,2) NOT NULL,
    "residual_value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "useful_life_months" INTEGER NOT NULL,
    "funding" "AssetFunding" NOT NULL,
    "paid_from_account_id" UUID,
    "opening_depreciation" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "opening_through" DATE,
    "status" "FixedAssetStatus" NOT NULL DEFAULT 'ACTIVE',
    "disposed_on" DATE,
    "disposal_proceeds" DECIMAL(14,2),
    "proceeds_account_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "fixed_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_depreciations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "fixed_asset_id" UUID NOT NULL,
    "period_end" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_depreciations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "credit_notes_organization_id_invoice_id_idx" ON "credit_notes"("organization_id", "invoice_id");

-- CreateIndex
CREATE INDEX "credit_notes_organization_id_issue_date_idx" ON "credit_notes"("organization_id", "issue_date");

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_organization_id_id_key" ON "credit_notes"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_organization_id_credit_note_number_key" ON "credit_notes"("organization_id", "credit_note_number");

-- CreateIndex
CREATE INDEX "credit_note_items_organization_id_credit_note_id_idx" ON "credit_note_items"("organization_id", "credit_note_id");

-- CreateIndex
CREATE INDEX "credit_note_items_organization_id_invoice_item_id_idx" ON "credit_note_items"("organization_id", "invoice_item_id");

-- CreateIndex
CREATE INDEX "bank_reconciliations_organization_id_account_id_statement_d_idx" ON "bank_reconciliations"("organization_id", "account_id", "statement_date");

-- CreateIndex
CREATE UNIQUE INDEX "bank_reconciliations_organization_id_id_key" ON "bank_reconciliations"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "reconciled_lines_journal_entry_line_id_key" ON "reconciled_lines"("journal_entry_line_id");

-- CreateIndex
CREATE INDEX "reconciled_lines_organization_id_reconciliation_id_idx" ON "reconciled_lines"("organization_id", "reconciliation_id");

-- CreateIndex
CREATE INDEX "fixed_assets_organization_id_status_idx" ON "fixed_assets"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_assets_organization_id_id_key" ON "fixed_assets"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_assets_organization_id_asset_number_key" ON "fixed_assets"("organization_id", "asset_number");

-- CreateIndex
CREATE INDEX "asset_depreciations_organization_id_period_end_idx" ON "asset_depreciations"("organization_id", "period_end");

-- CreateIndex
CREATE UNIQUE INDEX "asset_depreciations_organization_id_id_key" ON "asset_depreciations"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "asset_depreciations_fixed_asset_id_period_end_key" ON "asset_depreciations"("fixed_asset_id", "period_end");

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_organization_id_invoice_id_fkey" FOREIGN KEY ("organization_id", "invoice_id") REFERENCES "invoices"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_organization_id_customer_id_fkey" FOREIGN KEY ("organization_id", "customer_id") REFERENCES "customers"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_organization_id_refund_account_id_fkey" FOREIGN KEY ("organization_id", "refund_account_id") REFERENCES "chart_of_accounts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_organization_id_created_by_user_id_fkey" FOREIGN KEY ("organization_id", "created_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_items" ADD CONSTRAINT "credit_note_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_items" ADD CONSTRAINT "credit_note_items_organization_id_credit_note_id_fkey" FOREIGN KEY ("organization_id", "credit_note_id") REFERENCES "credit_notes"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_items" ADD CONSTRAINT "credit_note_items_invoice_item_id_fkey" FOREIGN KEY ("invoice_item_id") REFERENCES "invoice_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_items" ADD CONSTRAINT "credit_note_items_organization_id_account_id_fkey" FOREIGN KEY ("organization_id", "account_id") REFERENCES "chart_of_accounts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_organization_id_account_id_fkey" FOREIGN KEY ("organization_id", "account_id") REFERENCES "chart_of_accounts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_organization_id_created_by_user_id_fkey" FOREIGN KEY ("organization_id", "created_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_organization_id_completed_by_user_id_fkey" FOREIGN KEY ("organization_id", "completed_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciled_lines" ADD CONSTRAINT "reconciled_lines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciled_lines" ADD CONSTRAINT "reconciled_lines_organization_id_reconciliation_id_fkey" FOREIGN KEY ("organization_id", "reconciliation_id") REFERENCES "bank_reconciliations"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciled_lines" ADD CONSTRAINT "reconciled_lines_journal_entry_line_id_fkey" FOREIGN KEY ("journal_entry_line_id") REFERENCES "journal_entry_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_organization_id_asset_account_id_fkey" FOREIGN KEY ("organization_id", "asset_account_id") REFERENCES "chart_of_accounts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_organization_id_accumulated_account_id_fkey" FOREIGN KEY ("organization_id", "accumulated_account_id") REFERENCES "chart_of_accounts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_organization_id_expense_account_id_fkey" FOREIGN KEY ("organization_id", "expense_account_id") REFERENCES "chart_of_accounts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_organization_id_paid_from_account_id_fkey" FOREIGN KEY ("organization_id", "paid_from_account_id") REFERENCES "chart_of_accounts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_organization_id_proceeds_account_id_fkey" FOREIGN KEY ("organization_id", "proceeds_account_id") REFERENCES "chart_of_accounts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_organization_id_created_by_user_id_fkey" FOREIGN KEY ("organization_id", "created_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_depreciations" ADD CONSTRAINT "asset_depreciations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_depreciations" ADD CONSTRAINT "asset_depreciations_organization_id_fixed_asset_id_fkey" FOREIGN KEY ("organization_id", "fixed_asset_id") REFERENCES "fixed_assets"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Lines charged at 0% (or with no rate) were always reported as zero-rated supplies.
UPDATE "invoice_items" SET "vat_treatment" = 'ZERO_RATED' WHERE "tax_rate" = 0 OR "tax_rate" IS NULL;
UPDATE "estimate_items" SET "vat_treatment" = 'ZERO_RATED' WHERE "tax_rate" = 0 OR "tax_rate" IS NULL;

-- Sensible money: nothing negative, totals that add up, a life of at least a month.
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_amounts_valid" CHECK (
  subtotal >= 0 AND tax_amount >= 0 AND total_amount = subtotal + tax_amount
  AND refund_amount >= 0 AND refund_amount <= total_amount
);
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_amounts_valid" CHECK (
  cost > 0 AND residual_value >= 0 AND residual_value < cost
  AND useful_life_months > 0 AND opening_depreciation >= 0
  AND opening_depreciation <= cost - residual_value
  AND (funding <> 'OPENING' OR opening_through IS NOT NULL)
);
ALTER TABLE "asset_depreciations" ADD CONSTRAINT "asset_depreciations_amount_positive" CHECK (amount > 0);
ALTER TABLE "credit_note_items" ADD CONSTRAINT "credit_note_items_amounts_valid" CHECK (
  line_total >= 0 AND discount_amount >= 0 AND discount_amount <= line_total AND tax_amount >= 0
);

-- An invoice is never credited for less than nothing, or for more than it was.
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_credited_valid" CHECK (
  credited_amount >= 0 AND credited_amount <= total_amount
);
