-- Job-card photos (on the existing documents table) and optional signatures.
-- Additive only: new columns, a new table, indexes, constraints.
BEGIN;

-- CreateEnum
CREATE TYPE "MediaStage" AS ENUM ('INTAKE', 'INSPECTION', 'DIAGNOSIS', 'REPAIR', 'QUALITY_CHECK', 'DELIVERY', 'GENERAL');

-- CreateEnum
CREATE TYPE "SignatureContext" AS ENUM ('QUOTATION_APPROVAL', 'DELIVERY_HANDOVER');

-- CreateEnum
CREATE TYPE "SignerType" AS ENUM ('CUSTOMER', 'STAFF');


-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "deleted_by_user_id" UUID,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "job_card_id" UUID,
ADD COLUMN     "stage" "MediaStage";

-- CreateTable
CREATE TABLE "signatures" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "job_card_id" UUID NOT NULL,
    "context" "SignatureContext" NOT NULL,
    "approval_id" UUID,
    "signer_type" "SignerType" NOT NULL,
    "signer_name" TEXT NOT NULL,
    "customer_id" UUID,
    "captured_by_user_id" UUID,
    "document_id" UUID NOT NULL,
    "signed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signatures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "signatures_organization_id_job_card_id_idx" ON "signatures"("organization_id", "job_card_id");

-- CreateIndex
CREATE UNIQUE INDEX "signatures_organization_id_id_key" ON "signatures"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "signatures_organization_id_approval_id_key" ON "signatures"("organization_id", "approval_id");

-- CreateIndex
CREATE UNIQUE INDEX "signatures_organization_id_document_id_key" ON "signatures"("organization_id", "document_id");

-- CreateIndex
CREATE UNIQUE INDEX "one_handover_signature_per_job" ON "signatures"("organization_id", "job_card_id") WHERE (context = 'DELIVERY_HANDOVER');

-- CreateIndex
CREATE INDEX "documents_organization_id_job_card_id_stage_idx" ON "documents"("organization_id", "job_card_id", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "documents_organization_id_id_key" ON "documents"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_job_card_id_fkey" FOREIGN KEY ("organization_id", "job_card_id") REFERENCES "job_cards"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_deleted_by_user_id_fkey" FOREIGN KEY ("organization_id", "deleted_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_organization_id_job_card_id_fkey" FOREIGN KEY ("organization_id", "job_card_id") REFERENCES "job_cards"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_organization_id_approval_id_fkey" FOREIGN KEY ("organization_id", "approval_id") REFERENCES "approvals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_organization_id_customer_id_fkey" FOREIGN KEY ("organization_id", "customer_id") REFERENCES "customers"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_organization_id_captured_by_user_id_fkey" FOREIGN KEY ("organization_id", "captured_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_organization_id_document_id_fkey" FOREIGN KEY ("organization_id", "document_id") REFERENCES "documents"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Media rows that name a stage always belong to a job; a removal records who removed it.
ALTER TABLE "documents" ADD CONSTRAINT "documents_stage_needs_job" CHECK (stage IS NULL OR job_card_id IS NOT NULL);
ALTER TABLE "documents" ADD CONSTRAINT "documents_deletion_attributed" CHECK ((deleted_at IS NULL) = (deleted_by_user_id IS NULL));

-- A customer signature names the customer; a quotation-approval signature names the approval.
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_customer_signer_named" CHECK (signer_type <> 'CUSTOMER' OR customer_id IS NOT NULL);
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_approval_matches_context" CHECK ((context = 'QUOTATION_APPROVAL') = (approval_id IS NOT NULL));
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_signer_name_present" CHECK (length(btrim(signer_name)) > 0);

COMMIT;
