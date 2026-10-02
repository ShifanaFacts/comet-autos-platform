-- Purchase discounts, and the due date for paying a supplier later.
--
-- A purchase line can carry its own trade discount (a percentage or an AED
-- amount), and the purchase a discount on the whole bill, shared across the
-- lines to the fil. A trade discount lowers what the stock cost, the taxable
-- amount and the input VAT; it is never booked as income:
--
--   Dr Inventory        cost after discounts
--   Dr Input VAT        VAT on the discounted amount
--   Cr Trade payables   the total
--
-- purchase_items.net_amount is what the whole line costs after both
-- discounts, before VAT. It is set only on a purchase with a discount; every
-- existing line keeps it empty and is valued exactly as before.
--
-- purchases.due_date: when the supplier expects to be paid ("pay later").
-- Paying now is an ordinary supplier payment (supplier_payments) recorded in
-- the same transaction as the receipt, so nothing about payment is stored on
-- the purchase.
--
-- Additive only: new columns with defaults or empty. No existing row changes.

-- AlterTable
ALTER TABLE "purchases" ADD COLUMN     "bill_discount_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "bill_discount_type" "DiscountType",
ADD COLUMN     "bill_discount_value" DECIMAL(14,2),
ADD COLUMN     "due_date" DATE;

-- AlterTable
ALTER TABLE "purchase_items" ADD COLUMN     "discount_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "discount_type" "DiscountType",
ADD COLUMN     "discount_value" DECIMAL(14,2),
ADD COLUMN     "net_amount" DECIMAL(14,2);


-- A discount is never negative, and a line never costs less than nothing.
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_bill_discount_not_negative" CHECK (bill_discount_amount >= 0 AND (bill_discount_value IS NULL OR bill_discount_value >= 0));
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_discount_not_negative" CHECK (discount_amount >= 0 AND (discount_value IS NULL OR discount_value >= 0));
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_net_amount_not_negative" CHECK (net_amount IS NULL OR net_amount >= 0);
