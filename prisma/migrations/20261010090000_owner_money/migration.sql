-- Owner's money: an owner putting money into the business, or taking it out,
-- into or out of one of its cash, petty cash or bank accounts. Numbered OWN-.
-- Booked as journal source OWNER_MONEY:
--
--   capital in   Dr the money account / Cr Owner's capital (3000)
--   loan in      Dr the money account / Cr Due to owner (2520) — taken back
--                through "Reimburse owner", as any money owed to an owner
--   drawings     Dr Owner's drawings (3100) / Cr the money account
--
-- Never edited: a mistake is voided, which reverses its entry.
--
-- "Owner's capital" and "Owner's drawings" become system accounts (roles
-- OWNER_CAPITAL, OWNER_DRAWINGS): the chart adopts the 3000 / 3100 accounts a
-- workshop already has, and adds them where it has none. That happens in the
-- application the first time anything is booked — this migration changes no
-- existing row.
--
-- Additive only: a new table, new enums and new enum values.

-- AlterEnum
ALTER TYPE "AccountRole" ADD VALUE 'OWNER_CAPITAL';
ALTER TYPE "AccountRole" ADD VALUE 'OWNER_DRAWINGS';

-- AlterEnum
ALTER TYPE "JournalSource" ADD VALUE 'OWNER_MONEY';

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'OWNER_MONEY';

-- CreateEnum
CREATE TYPE "OwnerMoneyKind" AS ENUM ('CAPITAL_IN', 'LOAN_IN', 'DRAWINGS');

-- CreateEnum
CREATE TYPE "OwnerMoneyStatus" AS ENUM ('POSTED', 'VOID');

-- CreateTable
CREATE TABLE "owner_money" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "entry_number" TEXT NOT NULL,
    "kind" "OwnerMoneyKind" NOT NULL,
    "account_id" UUID NOT NULL,
    "owner_user_id" UUID,
    "amount" DECIMAL(14,2) NOT NULL,
    "moved_on" DATE NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "status" "OwnerMoneyStatus" NOT NULL DEFAULT 'POSTED',
    "voided_at" TIMESTAMPTZ,
    "void_reason" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "owner_money_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "owner_money_organization_id_moved_on_idx" ON "owner_money"("organization_id", "moved_on");

-- CreateIndex
CREATE UNIQUE INDEX "owner_money_organization_id_id_key" ON "owner_money"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "owner_money_organization_id_entry_number_key" ON "owner_money"("organization_id", "entry_number");

-- AddForeignKey
ALTER TABLE "owner_money" ADD CONSTRAINT "owner_money_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_money" ADD CONSTRAINT "owner_money_organization_id_account_id_fkey" FOREIGN KEY ("organization_id", "account_id") REFERENCES "chart_of_accounts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_money" ADD CONSTRAINT "owner_money_organization_id_owner_user_id_fkey" FOREIGN KEY ("organization_id", "owner_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_money" ADD CONSTRAINT "owner_money_organization_id_created_by_user_id_fkey" FOREIGN KEY ("organization_id", "created_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Always some money, and a void says why.
ALTER TABLE "owner_money" ADD CONSTRAINT "owner_money_amount_positive" CHECK (amount > 0);
ALTER TABLE "owner_money" ADD CONSTRAINT "owner_money_void_complete" CHECK (
  (status = 'VOID') = (voided_at IS NOT NULL)
);
