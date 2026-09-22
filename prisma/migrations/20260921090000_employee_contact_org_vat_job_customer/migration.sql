-- Additive only. Three independent changes in one transaction: if any step
-- fails, nothing is applied.
--
--   A. Employee contact details, independent of any system login.
--   B. JobCard keeps the customer it was opened for (backfilled).
--   C. VAT configuration on the organization.
--
-- No row is deleted and no existing column is changed or dropped.

BEGIN;

-- ---------------------------------------------------------------------------
-- A. Employee contact details
-- ---------------------------------------------------------------------------
ALTER TABLE "employees" ADD COLUMN "phone" TEXT,
ADD COLUMN "email" TEXT;

-- ---------------------------------------------------------------------------
-- C. Organization VAT configuration
--
-- Every existing organization becomes VAT-registered at 5.00% — exactly the
-- rate every organization has been charged until now, so no behaviour
-- changes on deploy. Existing estimate and invoice lines keep the rate they
-- were priced at; this only decides the default for new lines.
-- ---------------------------------------------------------------------------
ALTER TABLE "organizations" ADD COLUMN "is_vat_registered" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 5.00;

ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_vat_rate_range" CHECK ("vat_rate" >= 0 AND "vat_rate" <= 100);

-- ---------------------------------------------------------------------------
-- B. JobCard customer
--
-- 1. Add the column nullable, so existing rows are accepted.
-- 2. Backfill each job from its vehicle's owner. Before this migration no
--    vehicle had ever changed owner (every invoice and approval already
--    names the vehicle's current owner), so the current owner is the owner
--    at check-in for every existing job.
-- 3. Only then enforce NOT NULL. If any job were left unmatched, this step
--    fails and the whole transaction rolls back — nothing half-applied.
-- ---------------------------------------------------------------------------
ALTER TABLE "job_cards" ADD COLUMN "customer_id" UUID;

UPDATE "job_cards" AS j
SET "customer_id" = v."customer_id"
FROM "vehicles" AS v
WHERE v."id" = j."vehicle_id"
  AND v."organization_id" = j."organization_id";

ALTER TABLE "job_cards" ALTER COLUMN "customer_id" SET NOT NULL;

CREATE INDEX "job_cards_organization_id_customer_id_idx" ON "job_cards"("organization_id", "customer_id");

ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_organization_id_customer_id_fkey" FOREIGN KEY ("organization_id", "customer_id") REFERENCES "customers"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
