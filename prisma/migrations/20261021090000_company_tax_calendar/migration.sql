-- The company's dates, for the tax & accounting calendar.
--
--  * Its financial year: the month it ends, and the end of the first year
--    (often shorter or longer than twelve months).
--  * Its VAT return periods, as printed on the FTA's VAT registration
--    certificate: the first period, then back-to-back periods of 1 or 3
--    months. Returns and payment are due 28 days after each period ends.
--  * Its corporate tax registration number, and its trade licence.
--
-- Every column is nullable: nothing already recorded changes, and the
-- calendar asks for whatever is still missing.

ALTER TABLE "organizations"
  ADD COLUMN "financial_year_end_month" SMALLINT,
  ADD COLUMN "first_financial_year_end" DATE,
  ADD COLUMN "vat_first_period_start" DATE,
  ADD COLUMN "vat_first_period_end" DATE,
  ADD COLUMN "vat_period_months" SMALLINT,
  ADD COLUMN "corporate_tax_number" TEXT,
  ADD COLUMN "trade_licence_number" TEXT,
  ADD COLUMN "trade_licence_expiry" DATE;

ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_financial_year_end_month_check"
    CHECK ("financial_year_end_month" BETWEEN 1 AND 12),
  ADD CONSTRAINT "organizations_vat_period_months_check"
    CHECK ("vat_period_months" IN (1, 3)),
  -- The first period is a real range, set as a whole or not at all.
  ADD CONSTRAINT "organizations_vat_first_period_check"
    CHECK (
      ("vat_first_period_start" IS NULL AND "vat_first_period_end" IS NULL)
      OR ("vat_first_period_start" IS NOT NULL AND "vat_first_period_end" IS NOT NULL
          AND "vat_first_period_end" >= "vat_first_period_start")
    );
