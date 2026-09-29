-- Accounting masters: tax codes and payment modes.
--
-- Additive only: two new tables and a nullable tax_code_id on the lines that
-- carry VAT. No existing row is changed — lines saved before tax codes keep
-- their own rate and treatment, and the standard codes (SR, ZR, EX, OS) and
-- default payment modes are created for each workshop on first use
-- (lib/accounting/tax-codes.ts, lib/accounting/payment-modes.ts).

-- CreateTable
CREATE TABLE "tax_codes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rate" DECIMAL(5,2) NOT NULL,
    "treatment" "VatTreatment" NOT NULL,
    "for_sales" BOOLEAN NOT NULL DEFAULT true,
    "for_purchases" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tax_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_modes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "account_id" UUID NOT NULL,
    "for_receipts" BOOLEAN NOT NULL DEFAULT true,
    "for_payments" BOOLEAN NOT NULL DEFAULT true,
    "requires_reference" BOOLEAN NOT NULL DEFAULT false,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payment_modes_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "invoice_items" ADD COLUMN "tax_code_id" UUID;
ALTER TABLE "estimate_items" ADD COLUMN "tax_code_id" UUID;
ALTER TABLE "purchase_items" ADD COLUMN "tax_code_id" UUID;
ALTER TABLE "expenses" ADD COLUMN "tax_code_id" UUID;

-- CreateIndex
CREATE INDEX "tax_codes_organization_id_idx" ON "tax_codes"("organization_id");
CREATE UNIQUE INDEX "tax_codes_organization_id_id_key" ON "tax_codes"("organization_id", "id");
CREATE UNIQUE INDEX "tax_codes_organization_id_code_key" ON "tax_codes"("organization_id", "code");
CREATE INDEX "payment_modes_organization_id_idx" ON "payment_modes"("organization_id");
CREATE UNIQUE INDEX "payment_modes_organization_id_id_key" ON "payment_modes"("organization_id", "id");
CREATE UNIQUE INDEX "payment_modes_organization_id_name_key" ON "payment_modes"("organization_id", "name");

-- AddForeignKey
ALTER TABLE "tax_codes" ADD CONSTRAINT "tax_codes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_modes" ADD CONSTRAINT "payment_modes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_modes" ADD CONSTRAINT "payment_modes_organization_id_account_id_fkey" FOREIGN KEY ("organization_id", "account_id") REFERENCES "chart_of_accounts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_organization_id_tax_code_id_fkey" FOREIGN KEY ("organization_id", "tax_code_id") REFERENCES "tax_codes"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "estimate_items" ADD CONSTRAINT "estimate_items_organization_id_tax_code_id_fkey" FOREIGN KEY ("organization_id", "tax_code_id") REFERENCES "tax_codes"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_organization_id_tax_code_id_fkey" FOREIGN KEY ("organization_id", "tax_code_id") REFERENCES "tax_codes"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_organization_id_tax_code_id_fkey" FOREIGN KEY ("organization_id", "tax_code_id") REFERENCES "tax_codes"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A rate belongs only to a standard-rated code; every other treatment is 0%.
ALTER TABLE "tax_codes" ADD CONSTRAINT "tax_codes_rate_matches_treatment" CHECK (
  rate >= 0 AND rate <= 100
  AND (treatment = 'STANDARD' OR rate = 0)
);

-- At most one default tax code and one default payment mode per workshop.
CREATE UNIQUE INDEX "tax_codes_one_default" ON "tax_codes"("organization_id") WHERE "is_default";
CREATE UNIQUE INDEX "payment_modes_one_default" ON "payment_modes"("organization_id") WHERE "is_default";
