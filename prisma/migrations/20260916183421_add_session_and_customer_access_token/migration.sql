-- CreateEnum
CREATE TYPE "CustomerAccessResourceType" AS ENUM ('ESTIMATE', 'INVOICE');

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_access_tokens" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "resource_type" "CustomerAccessResourceType" NOT NULL,
    "resource_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "last_accessed_at" TIMESTAMPTZ,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_access_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_organization_id_idx" ON "sessions"("organization_id");

-- CreateIndex
CREATE INDEX "sessions_organization_id_user_id_idx" ON "sessions"("organization_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_access_tokens_token_hash_key" ON "customer_access_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "customer_access_tokens_organization_id_idx" ON "customer_access_tokens"("organization_id");

-- CreateIndex
CREATE INDEX "customer_access_tokens_organization_id_resource_type_resour_idx" ON "customer_access_tokens"("organization_id", "resource_type", "resource_id");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_organization_id_user_id_fkey" FOREIGN KEY ("organization_id", "user_id") REFERENCES "users"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_access_tokens" ADD CONSTRAINT "customer_access_tokens_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_access_tokens" ADD CONSTRAINT "customer_access_tokens_organization_id_created_by_user_id_fkey" FOREIGN KEY ("organization_id", "created_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
