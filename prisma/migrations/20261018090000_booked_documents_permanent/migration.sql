-- Booked documents are permanent.
--
-- Once an invoice, payment, purchase, expense or any other money document is
-- in the books, it is corrected the way an accountant corrects it — voided,
-- cancelled, reversed or credited, each of which leaves the original on
-- record and books the opposite entry. It is never deleted: deleting the
-- record leaves its journal entries behind (they are permanent), so the
-- books and the documents stop agreeing. That is what happened on
-- 5 October 2026, when two duplicate purchases were deleted directly in the
-- database and their stock, input VAT and supplier balance stayed booked.
--
-- The app itself never deletes these documents. Drafts — an invoice not yet
-- issued, a purchase not yet received — are not in the books and can still
-- be deleted. TRUNCATE is refused outright.
--
-- Purely additive: no table, column or row changes. The test-organization
-- clean-up must switch these triggers off by name, alongside the journal,
-- stock-ledger and audit-log ones it already handles.

CREATE FUNCTION booked_document_is_permanent() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'This % is in the books and cannot be deleted. Void, cancel, reverse or credit it in the app instead.',
    TG_ARGV[0]
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE FUNCTION booked_documents_no_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Booked documents cannot be truncated (%).', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;

-- Invoices: only a draft (never issued, never booked) may go.
CREATE TRIGGER invoices_booked_permanent
  BEFORE DELETE ON "invoices"
  FOR EACH ROW WHEN (OLD.status <> 'DRAFT')
  EXECUTE FUNCTION booked_document_is_permanent('invoice');

-- Purchases: a draft or an order nothing has been received on may go.
CREATE TRIGGER purchases_booked_permanent
  BEFORE DELETE ON "purchases"
  FOR EACH ROW WHEN (OLD.status NOT IN ('DRAFT', 'ORDERED', 'CANCELLED'))
  EXECUTE FUNCTION booked_document_is_permanent('purchase');

-- Booked the moment they are recorded; withdrawn ones stay on record, voided.
CREATE TRIGGER payments_booked_permanent
  BEFORE DELETE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION booked_document_is_permanent('payment');

CREATE TRIGGER supplier_payments_booked_permanent
  BEFORE DELETE ON "supplier_payments"
  FOR EACH ROW EXECUTE FUNCTION booked_document_is_permanent('supplier payment');

CREATE TRIGGER expenses_booked_permanent
  BEFORE DELETE ON "expenses"
  FOR EACH ROW EXECUTE FUNCTION booked_document_is_permanent('expense');

CREATE TRIGGER credit_notes_booked_permanent
  BEFORE DELETE ON "credit_notes"
  FOR EACH ROW EXECUTE FUNCTION booked_document_is_permanent('credit note');

CREATE TRIGGER customer_advances_booked_permanent
  BEFORE DELETE ON "customer_advances"
  FOR EACH ROW EXECUTE FUNCTION booked_document_is_permanent('customer advance');

CREATE TRIGGER owner_money_booked_permanent
  BEFORE DELETE ON "owner_money"
  FOR EACH ROW EXECUTE FUNCTION booked_document_is_permanent('owner''s money entry');

CREATE TRIGGER money_transfers_booked_permanent
  BEFORE DELETE ON "money_transfers"
  FOR EACH ROW EXECUTE FUNCTION booked_document_is_permanent('money transfer');

-- No emptying a table in one statement either.
CREATE TRIGGER invoices_no_truncate BEFORE TRUNCATE ON "invoices"
  FOR EACH STATEMENT EXECUTE FUNCTION booked_documents_no_truncate();
CREATE TRIGGER purchases_no_truncate BEFORE TRUNCATE ON "purchases"
  FOR EACH STATEMENT EXECUTE FUNCTION booked_documents_no_truncate();
CREATE TRIGGER payments_no_truncate BEFORE TRUNCATE ON "payments"
  FOR EACH STATEMENT EXECUTE FUNCTION booked_documents_no_truncate();
CREATE TRIGGER supplier_payments_no_truncate BEFORE TRUNCATE ON "supplier_payments"
  FOR EACH STATEMENT EXECUTE FUNCTION booked_documents_no_truncate();
CREATE TRIGGER expenses_no_truncate BEFORE TRUNCATE ON "expenses"
  FOR EACH STATEMENT EXECUTE FUNCTION booked_documents_no_truncate();
CREATE TRIGGER credit_notes_no_truncate BEFORE TRUNCATE ON "credit_notes"
  FOR EACH STATEMENT EXECUTE FUNCTION booked_documents_no_truncate();
CREATE TRIGGER customer_advances_no_truncate BEFORE TRUNCATE ON "customer_advances"
  FOR EACH STATEMENT EXECUTE FUNCTION booked_documents_no_truncate();
CREATE TRIGGER owner_money_no_truncate BEFORE TRUNCATE ON "owner_money"
  FOR EACH STATEMENT EXECUTE FUNCTION booked_documents_no_truncate();
CREATE TRIGGER money_transfers_no_truncate BEFORE TRUNCATE ON "money_transfers"
  FOR EACH STATEMENT EXECUTE FUNCTION booked_documents_no_truncate();
