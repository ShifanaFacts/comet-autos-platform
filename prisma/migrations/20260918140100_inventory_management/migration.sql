-- Inventory management: part categories, supplier invoice references on
-- purchases, reversal links and integrity rules for the stock ledger.
-- Additive only: no existing row is changed or removed.
BEGIN;

-- Columns
ALTER TABLE "parts" ADD COLUMN "category" TEXT;

ALTER TABLE "purchases" ADD COLUMN "notes" TEXT,
ADD COLUMN "supplier_invoice_date" DATE,
ADD COLUMN "supplier_invoice_number" TEXT;

ALTER TABLE "inventory_transactions" ADD COLUMN "reversal_of_transaction_id" UUID;

-- Indexes
CREATE INDEX "parts_organization_id_category_idx" ON "parts"("organization_id", "category");
CREATE INDEX "inventory_transactions_organization_id_part_usage_id_idx" ON "inventory_transactions"("organization_id", "part_usage_id");
CREATE INDEX "inventory_transactions_organization_id_purchase_item_id_idx" ON "inventory_transactions"("organization_id", "purchase_item_id");
CREATE UNIQUE INDEX "inventory_transactions_organization_id_id_key" ON "inventory_transactions"("organization_id", "id");
CREATE UNIQUE INDEX "inventory_transactions_organization_id_reversal_of_transact_key" ON "inventory_transactions"("organization_id", "reversal_of_transaction_id");
CREATE UNIQUE INDEX "one_live_purchase_per_supplier_invoice" ON "purchases"("organization_id", "supplier_id", "supplier_invoice_number") WHERE (supplier_invoice_number IS NOT NULL AND status <> 'CANCELLED');

-- A reversal points at the row it cancels, in the same organization.
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_organization_id_reversal_of_transac_fkey" FOREIGN KEY ("organization_id", "reversal_of_transaction_id") REFERENCES "inventory_transactions"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Ledger integrity. Every movement moves something; its sign follows its type;
-- job movements name the part usage, receipts name the purchase line, and
-- only a REVERSAL (always) points at another row.
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_quantity_nonzero" CHECK (quantity <> 0);
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_sign_matches_type" CHECK (
  CASE
    WHEN transaction_type IN ('PURCHASE_RECEIPT', 'OPENING_STOCK', 'JOB_RETURN', 'TRANSFER_IN', 'CUSTOMER_RETURN') THEN quantity > 0
    WHEN transaction_type IN ('JOB_CONSUMPTION', 'TRANSFER_OUT', 'RETURN_TO_SUPPLIER') THEN quantity < 0
    ELSE true
  END
);
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_job_movements_name_usage"
  CHECK ((transaction_type IN ('JOB_CONSUMPTION', 'JOB_RETURN')) = (part_usage_id IS NOT NULL));
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_receipt_names_purchase_line"
  CHECK (transaction_type <> 'PURCHASE_RECEIPT' OR purchase_item_id IS NOT NULL);
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_reversal_names_original"
  CHECK ((transaction_type = 'REVERSAL') = (reversal_of_transaction_id IS NOT NULL));

-- The ledger is append-only: corrections are new rows, never edits or deletes.
CREATE FUNCTION inventory_transactions_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'inventory_transactions is append-only (% refused); post a reversal or return instead', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER inventory_transactions_append_only
  BEFORE UPDATE OR DELETE ON "inventory_transactions"
  FOR EACH ROW EXECUTE FUNCTION inventory_transactions_append_only();

-- Purchases: lines receive at most what was ordered; totals add up.
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_quantities"
  CHECK (quantity_ordered > 0 AND quantity_received >= 0 AND quantity_received <= quantity_ordered AND unit_cost >= 0);
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_total_is_subtotal_plus_tax"
  CHECK (total_amount IS NULL OR (subtotal >= 0 AND tax_amount >= 0 AND total_amount = subtotal + tax_amount));

COMMIT;
