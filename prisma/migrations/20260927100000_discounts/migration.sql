-- Discounts on quotations and invoices, and the customer's order number on
-- invoices.
--
-- Each line may carry its own discount, and the whole bill one more, taken
-- after the lines'. A discount is stored as entered (a percentage or a fixed
-- amount) and as the AED it came to.
--
-- Totals keep their meaning: a line's line_total is net of its own
-- discount, and a document's subtotal is the taxable amount — net of every
-- discount — so total_amount = subtotal + tax_amount (already enforced on
-- invoices) holds as before.
--
-- Purely additive. Existing rows get no discount (amount 0, no type), which
-- is exactly what they had: no figure on any existing document changes.

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'AMOUNT');

-- AlterTable
ALTER TABLE "estimates" ADD COLUMN "discount_type" "DiscountType",
ADD COLUMN "discount_value" DECIMAL(14,2),
ADD COLUMN "discount_amount" DECIMAL(14,2) NOT NULL DEFAULT 0;

ALTER TABLE "estimate_items" ADD COLUMN "discount_type" "DiscountType",
ADD COLUMN "discount_value" DECIMAL(14,2),
ADD COLUMN "discount_amount" DECIMAL(14,2) NOT NULL DEFAULT 0;

ALTER TABLE "invoices" ADD COLUMN "discount_type" "DiscountType",
ADD COLUMN "discount_value" DECIMAL(14,2),
ADD COLUMN "discount_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN "customer_reference" TEXT;

ALTER TABLE "invoice_items" ADD COLUMN "discount_type" "DiscountType",
ADD COLUMN "discount_value" DECIMAL(14,2),
ADD COLUMN "discount_amount" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- A discount is never negative, a percentage never exceeds 100, and the
-- type and value are set together or not at all.
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_discount_valid" CHECK (
  discount_amount >= 0
  AND (discount_type IS NULL) = (discount_value IS NULL)
  AND (discount_value IS NULL OR discount_value >= 0)
  AND (discount_type IS DISTINCT FROM 'PERCENT' OR discount_value <= 100)
);
ALTER TABLE "estimate_items" ADD CONSTRAINT "estimate_items_discount_valid" CHECK (
  discount_amount >= 0
  AND (discount_type IS NULL) = (discount_value IS NULL)
  AND (discount_value IS NULL OR discount_value >= 0)
  AND (discount_type IS DISTINCT FROM 'PERCENT' OR discount_value <= 100)
);
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_discount_valid" CHECK (
  discount_amount >= 0
  AND (discount_type IS NULL) = (discount_value IS NULL)
  AND (discount_value IS NULL OR discount_value >= 0)
  AND (discount_type IS DISTINCT FROM 'PERCENT' OR discount_value <= 100)
);
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_discount_valid" CHECK (
  discount_amount >= 0
  AND (discount_type IS NULL) = (discount_value IS NULL)
  AND (discount_value IS NULL OR discount_value >= 0)
  AND (discount_type IS DISTINCT FROM 'PERCENT' OR discount_value <= 100)
);
