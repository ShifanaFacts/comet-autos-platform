-- One-time request keys for duplicate-safe form submissions (additive).
BEGIN;

CREATE TABLE "request_keys" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "request_key" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "result_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "request_keys_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "request_keys_created_at_idx" ON "request_keys"("created_at");
CREATE UNIQUE INDEX "request_keys_organization_id_user_id_request_key_key" ON "request_keys"("organization_id", "user_id", "request_key");

COMMIT;
