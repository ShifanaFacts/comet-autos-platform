-- Quotations and invoices become documents in their own right.
--
-- Purely additive: nothing is dropped or renamed, and no existing row
-- changes meaning. estimates.job_card_id is RELAXED to nullable so a
-- quotation can be raised straight for a customer; the branch, customer and
-- vehicle an estimate used to read through that join are copied onto the
-- row itself and backfilled, so every existing quotation answers exactly
-- the same questions it answered before. invoices gains the vehicle for the
-- same reason: an invoice raised without a job card must still name the car.

-- 1. Relax the job card requirement on a quotation.
ALTER TABLE "estimates" ALTER COLUMN "job_card_id" DROP NOT NULL;

-- 2. Add the columns nullable, so the backfill can run before they are required.
ALTER TABLE "estimates" ADD COLUMN "branch_id" UUID;
ALTER TABLE "estimates" ADD COLUMN "customer_id" UUID;
ALTER TABLE "estimates" ADD COLUMN "vehicle_id" UUID;
ALTER TABLE "invoices" ADD COLUMN "vehicle_id" UUID;

-- 3. Backfill from the job card the document already belongs to. Every
--    existing estimate has one (the column was NOT NULL until step 1), so
--    every row gets a branch and a customer.
UPDATE "estimates" e
   SET "branch_id"   = j."branch_id",
       "customer_id" = j."customer_id",
       "vehicle_id"  = j."vehicle_id"
  FROM "job_cards" j
 WHERE j."id" = e."job_card_id";

UPDATE "invoices" i
   SET "vehicle_id" = j."vehicle_id"
  FROM "job_cards" j
 WHERE j."id" = i."job_card_id";

-- 4. A quotation always belongs to a branch and a customer, job card or not.
ALTER TABLE "estimates" ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "estimates" ALTER COLUMN "customer_id" SET NOT NULL;

-- 5. Indexes.
CREATE INDEX "estimates_organization_id_branch_id_idx" ON "estimates"("organization_id", "branch_id");
CREATE INDEX "estimates_organization_id_customer_id_idx" ON "estimates"("organization_id", "customer_id");
CREATE INDEX "estimates_organization_id_vehicle_id_idx" ON "estimates"("organization_id", "vehicle_id");
CREATE INDEX "invoices_organization_id_vehicle_id_idx" ON "invoices"("organization_id", "vehicle_id");

-- 6. Foreign keys, organization-scoped like every other relation here, so a
--    quotation can never point at another organization's customer.
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_organization_id_customer_id_fkey" FOREIGN KEY ("organization_id", "customer_id") REFERENCES "customers"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_organization_id_vehicle_id_fkey" FOREIGN KEY ("organization_id", "vehicle_id") REFERENCES "vehicles"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_vehicle_id_fkey" FOREIGN KEY ("organization_id", "vehicle_id") REFERENCES "vehicles"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
