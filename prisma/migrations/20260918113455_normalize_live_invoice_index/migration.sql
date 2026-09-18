-- Re-express the "one live invoice per job card" partial unique index with
-- plain <> conditions so the predicate PostgreSQL stores round-trips with the
-- Prisma schema (a NOT IN list is rewritten to "<> ALL (ARRAY[...])", which
-- Prisma would otherwise report as drift on every migration). Same rule:
-- NULL job_card_id values never collide in a unique index anyway.
-- The invoices table is empty at this point; no data is touched.
BEGIN;
DROP INDEX "one_live_invoice_per_job_card";
CREATE UNIQUE INDEX "one_live_invoice_per_job_card" ON "invoices"("job_card_id") WHERE (status <> 'VOID' AND status <> 'CANCELLED');
COMMIT;
