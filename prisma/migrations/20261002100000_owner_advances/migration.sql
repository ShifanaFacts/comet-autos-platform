-- Follow-up to 20261002090000_owner_paid_expenses, to the names agreed for
-- the feature: the account role is OWNER_ADVANCES and the expense column is
-- paid_by_user_id. Renames only (no data exists under the old names on the
-- live workshop), plus a reference on each repayment.
ALTER TYPE "AccountRole" RENAME VALUE 'OWNER_CURRENT' TO 'OWNER_ADVANCES';

ALTER TABLE "expenses" RENAME COLUMN "paid_by_person_user_id" TO "paid_by_user_id";
ALTER TABLE "expenses" RENAME CONSTRAINT "expenses_organization_id_paid_by_person_user_id_fkey"
  TO "expenses_organization_id_paid_by_user_id_fkey";

ALTER TABLE "owner_reimbursements" ADD COLUMN "reference" TEXT;
