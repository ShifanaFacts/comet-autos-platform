-- Payroll: the end-of-service gratuity set aside every month, and the WPS
-- salary file.
--
--  * Two account roles, so the payroll entry can book the gratuity: the
--    standard chart's "End-of-service benefits expense" (5165) and
--    "Provision for end-of-service benefits" (2500) are adopted for them the
--    next time anything is booked (lib/accounting/chart.ts).
--  * Each payroll line keeps the gratuity earned to the period end and the
--    increase over the last payroll. Lines already recorded keep 0.
--  * The WPS details: the company's MOHRE establishment number and paying
--    bank's routing code; each employee's MOHRE person code, bank routing
--    code and IBAN. All optional — the salary file asks for what is missing.

ALTER TYPE "AccountRole" ADD VALUE IF NOT EXISTS 'GRATUITY_EXPENSE';
ALTER TYPE "AccountRole" ADD VALUE IF NOT EXISTS 'GRATUITY_PROVISION';

ALTER TABLE "organizations"
  ADD COLUMN "mohre_establishment_id" TEXT,
  ADD COLUMN "wps_routing_code" TEXT;

ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_mohre_establishment_id_check"
    CHECK ("mohre_establishment_id" ~ '^[0-9]{13}$'),
  ADD CONSTRAINT "organizations_wps_routing_code_check"
    CHECK ("wps_routing_code" ~ '^[0-9]{9}$');

ALTER TABLE "employees"
  ADD COLUMN "wps_person_code" TEXT,
  ADD COLUMN "wps_agent_code" TEXT,
  ADD COLUMN "salary_iban" TEXT;

ALTER TABLE "employees"
  ADD CONSTRAINT "employees_wps_person_code_check"
    CHECK ("wps_person_code" ~ '^[0-9]{14}$'),
  ADD CONSTRAINT "employees_wps_agent_code_check"
    CHECK ("wps_agent_code" ~ '^[0-9]{9}$'),
  ADD CONSTRAINT "employees_salary_iban_check"
    CHECK ("salary_iban" ~ '^AE[0-9]{21}$');

ALTER TABLE "payroll_items"
  ADD COLUMN "gratuity_liability" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "gratuity_accrual" DECIMAL(14,2) NOT NULL DEFAULT 0;

ALTER TABLE "payroll_items"
  ADD CONSTRAINT "payroll_items_gratuity_liability_check"
    CHECK ("gratuity_liability" >= 0);
