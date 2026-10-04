-- Designations and employee logins.
--
-- Designations (Technician, Supervisor, Manager…) are kept under HR; each
-- carries a role, and so the permissions an employee's login is given. An
-- employee's login signs in with their employee code (`username`), may have
-- no email, and is made to choose its own password at the first sign-in.
--
-- Additive only: one new table, new nullable columns or columns with
-- defaults, and `users.email` no longer required. No existing row changes.

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL,
ADD COLUMN     "username" TEXT,
ADD COLUMN     "must_change_password" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "designation_id" UUID;

-- CreateTable
CREATE TABLE "designations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "role_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "designations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "designations_organization_id_idx" ON "designations"("organization_id");

-- CreateIndex
CREATE INDEX "designations_organization_id_role_id_idx" ON "designations"("organization_id", "role_id");

-- CreateIndex
CREATE UNIQUE INDEX "designations_organization_id_id_key" ON "designations"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "designations_organization_id_name_key" ON "designations"("organization_id", "name");

-- CreateIndex
CREATE INDEX "employees_organization_id_designation_id_idx" ON "employees"("organization_id", "designation_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_organization_id_username_key" ON "users"("organization_id", "username");

-- AddForeignKey
ALTER TABLE "designations" ADD CONSTRAINT "designations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "designations" ADD CONSTRAINT "designations_organization_id_role_id_fkey" FOREIGN KEY ("organization_id", "role_id") REFERENCES "roles"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_organization_id_designation_id_fkey" FOREIGN KEY ("organization_id", "designation_id") REFERENCES "designations"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
