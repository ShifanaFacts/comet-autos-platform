-- Partners: the business's owners as names the accountant keeps (not app
-- logins), so each partner's money put in, lent and taken out on Owner's
-- money is recorded against them — and totalled per partner.
--
-- Additive only: a new table and one nullable column on owner_money. No
-- existing row changes.

-- CreateTable
CREATE TABLE "partners" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "partners_organization_id_idx" ON "partners"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "partners_organization_id_id_key" ON "partners"("organization_id", "id");

-- One partner per name in a workshop, however it is typed.
CREATE UNIQUE INDEX "partners_organization_id_name_key" ON "partners"("organization_id", lower("name"));

-- AddForeignKey
ALTER TABLE "partners" ADD CONSTRAINT "partners_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A name, not blank.
ALTER TABLE "partners" ADD CONSTRAINT "partners_name_present" CHECK (length(trim(name)) > 0);

-- AlterTable
ALTER TABLE "owner_money" ADD COLUMN "partner_id" UUID;

-- AddForeignKey
ALTER TABLE "owner_money" ADD CONSTRAINT "owner_money_organization_id_partner_id_fkey" FOREIGN KEY ("organization_id", "partner_id") REFERENCES "partners"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
