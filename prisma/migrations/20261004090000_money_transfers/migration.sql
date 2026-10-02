-- Money: moving the workshop's own money between its cash, petty cash, bank
-- and card accounts — cash on hand into the petty-cash box, the day's
-- takings into the bank. Neither income nor expense: the books show Dr the
-- account it went to, Cr the account it came from (journal source
-- MONEY_TRANSFER). Numbered TRF-. A transfer is never edited; a mistake is
-- voided, which reverses its entry.
--
-- Additive only: a new table and new enum values. No existing row changes.

-- CreateEnum
CREATE TYPE "MoneyTransferStatus" AS ENUM ('POSTED', 'VOID');

-- AlterEnum
ALTER TYPE "JournalSource" ADD VALUE 'MONEY_TRANSFER';

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'MONEY_TRANSFER';

-- CreateTable
CREATE TABLE "money_transfers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "transfer_number" TEXT NOT NULL,
    "from_account_id" UUID NOT NULL,
    "to_account_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "transferred_on" DATE NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "status" "MoneyTransferStatus" NOT NULL DEFAULT 'POSTED',
    "voided_at" TIMESTAMPTZ,
    "void_reason" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "money_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "money_transfers_organization_id_transferred_on_idx" ON "money_transfers"("organization_id", "transferred_on");

-- CreateIndex
CREATE UNIQUE INDEX "money_transfers_organization_id_id_key" ON "money_transfers"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "money_transfers_organization_id_transfer_number_key" ON "money_transfers"("organization_id", "transfer_number");

-- AddForeignKey
ALTER TABLE "money_transfers" ADD CONSTRAINT "money_transfers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "money_transfers" ADD CONSTRAINT "money_transfers_organization_id_from_account_id_fkey" FOREIGN KEY ("organization_id", "from_account_id") REFERENCES "chart_of_accounts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "money_transfers" ADD CONSTRAINT "money_transfers_organization_id_to_account_id_fkey" FOREIGN KEY ("organization_id", "to_account_id") REFERENCES "chart_of_accounts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "money_transfers" ADD CONSTRAINT "money_transfers_organization_id_created_by_user_id_fkey" FOREIGN KEY ("organization_id", "created_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- A transfer moves something, and between two different accounts.
ALTER TABLE "money_transfers" ADD CONSTRAINT "money_transfers_amount_positive" CHECK (amount > 0);
ALTER TABLE "money_transfers" ADD CONSTRAINT "money_transfers_two_accounts" CHECK (from_account_id <> to_account_id);
