-- Data + integrity migration for the workshop status model and approval
-- attribution. Runs after 20260918070227_workshop_status_and_approval_attribution,
-- which added the enum values (PostgreSQL cannot use a new enum value in the
-- transaction that adds it). No rows are deleted.
--
-- Prisma does not wrap migration scripts in a transaction, so this one does it
-- explicitly: the data backfill, NOT NULL change and constraints apply
-- all-or-nothing.
BEGIN;

-- 1. Move live job cards off the legacy coarse statuses.
--    JobStatusHistory is append-only and is NOT rewritten: it keeps the names
--    in force when each change happened. The application reads legacy history
--    values through a mapping (src/lib/workshop/stages.ts).
CREATE TEMP TABLE job_status_migration ON COMMIT DROP AS
SELECT
  j.id,
  j.organization_id,
  j.branch_id,
  j.status AS old_status,
  (CASE j.status
     WHEN 'RECEIVED' THEN 'ARRIVED'
     WHEN 'INSPECTING' THEN 'INSPECTION'
     WHEN 'DIAGNOSED' THEN CASE WHEN latest.status IS NOT NULL THEN 'ESTIMATE' ELSE 'DIAGNOSIS' END
     WHEN 'ESTIMATE_SENT' THEN CASE latest.status
                                 WHEN 'REJECTED' THEN 'REJECTED'
                                 WHEN 'DRAFT' THEN 'ESTIMATE'
                                 ELSE 'WAITING_APPROVAL' END
     WHEN 'IN_PROGRESS' THEN 'REPAIR'
     WHEN 'COMPLETED' THEN 'READY'
     WHEN 'CLOSED' THEN 'DELIVERED'
   END)::"JobCardStatus" AS new_status
FROM "job_cards" j
LEFT JOIN LATERAL (
  SELECT e.status FROM "estimates" e
  WHERE e.job_card_id = j.id AND e.organization_id = j.organization_id
  ORDER BY e.version DESC
  LIMIT 1
) latest ON TRUE
WHERE j.status IN ('RECEIVED', 'INSPECTING', 'DIAGNOSED', 'ESTIMATE_SENT', 'IN_PROGRESS', 'COMPLETED', 'CLOSED');

UPDATE "job_cards" j
SET status = m.new_status, updated_at = CURRENT_TIMESTAMP
FROM job_status_migration m
WHERE j.id = m.id;

INSERT INTO "audit_logs" (id, organization_id, branch_id, actor_user_id, action, entity_type, entity_id, before_data, after_data, metadata, created_at)
SELECT gen_random_uuid(), organization_id, branch_id, NULL, 'job_card.status_migrated', 'JobCard', id,
       jsonb_build_object('status', old_status), jsonb_build_object('status', new_status),
       jsonb_build_object('source', 'migration', 'migration', '20260918_job_status_and_approval_data'),
       CURRENT_TIMESTAMP
FROM job_status_migration;

-- 2. Online quotation decisions were stored as DIGITAL_SIGNATURE and
--    attributed to the staff member who sent the link. Correct them: method
--    ONLINE, no recording staff member (the sender stays on Estimate.sent_by).
--    Only rows whose audit entry says the customer decided are touched.
UPDATE "approvals" a
SET approval_method = 'ONLINE', recorded_by_user_id = NULL, updated_at = CURRENT_TIMESTAMP
WHERE a.approval_method = 'DIGITAL_SIGNATURE'
  AND EXISTS (
    SELECT 1 FROM "audit_logs" l
    WHERE l.organization_id = a.organization_id
      AND l.entity_type = 'Approval'
      AND l.entity_id = a.id
      AND l.metadata ->> 'decidedBy' = 'customer'
  );

-- 3. Every approval records the deciding customer and when they decided.
UPDATE "approvals" a
SET customer_id = v.customer_id,
    decided_at = a.created_at
FROM "estimates" e
JOIN "job_cards" j ON j.id = e.job_card_id AND j.organization_id = e.organization_id
JOIN "vehicles" v ON v.id = j.vehicle_id AND v.organization_id = j.organization_id
WHERE e.id = a.estimate_id AND e.organization_id = a.organization_id;

-- AlterTable (generated)
ALTER TABLE "approvals" ALTER COLUMN "customer_id" SET NOT NULL;

-- AlterTable (generated)
ALTER TABLE "job_cards" ALTER COLUMN "status" SET DEFAULT 'ARRIVED';

-- 4. Integrity rules Prisma can't express natively (same approach as the
--    PROFORMA check in the init migration).
-- An ONLINE decision has no recording staff member; any other method must have one.
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_recorder_matches_method"
  CHECK ((approval_method = 'ONLINE') = (recorded_by_user_id IS NULL));

-- Every status change has exactly one actor: a staff user or a customer.
ALTER TABLE "job_status_history" ADD CONSTRAINT "job_status_history_single_actor"
  CHECK (num_nonnulls(changed_by_user_id, changed_by_customer_id) = 1);

COMMIT;
