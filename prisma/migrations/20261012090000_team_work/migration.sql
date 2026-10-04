-- Team work: location-locked self check-in, missed check-out review, tasks
-- (to-dos) with voice notes and photos, and the workshop TV link.
--
-- Additive only: new enums, new nullable columns or columns with defaults,
-- two new tables. No existing row changes meaning.

-- CreateEnum
CREATE TYPE "ClockMethod" AS ENUM ('SELF', 'STAFF', 'AUTO', 'REPORTED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "TaskUpdateKind" AS ENUM ('NOTE', 'STATUS', 'CHANGED', 'MOVED');

-- AlterEnum
ALTER TYPE "DocumentCategory" ADD VALUE 'VOICE_NOTE';

-- AlterTable
ALTER TABLE "attendances" ADD COLUMN     "clock_in_accuracy_m" INTEGER,
ADD COLUMN     "clock_in_distance_m" INTEGER,
ADD COLUMN     "clock_in_latitude" DECIMAL(9,6),
ADD COLUMN     "clock_in_longitude" DECIMAL(9,6),
ADD COLUMN     "clock_in_method" "ClockMethod",
ADD COLUMN     "clock_out_accuracy_m" INTEGER,
ADD COLUMN     "clock_out_distance_m" INTEGER,
ADD COLUMN     "clock_out_latitude" DECIMAL(9,6),
ADD COLUMN     "clock_out_longitude" DECIMAL(9,6),
ADD COLUMN     "clock_out_method" "ClockMethod",
ADD COLUMN     "needs_review" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reviewed_at" TIMESTAMPTZ,
ADD COLUMN     "reviewed_by_user_id" UUID;

-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "geofence_radius_m" INTEGER NOT NULL DEFAULT 150,
ADD COLUMN     "latitude" DECIMAL(9,6),
ADD COLUMN     "longitude" DECIMAL(9,6),
ADD COLUMN     "shift_end_time" TEXT NOT NULL DEFAULT '20:00';

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "task_id" UUID;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "display_token_hash" TEXT;

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "assignee_employee_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "details" TEXT,
    "language" TEXT,
    "is_assigned" BOOLEAN NOT NULL DEFAULT false,
    "priority" "TaskPriority" NOT NULL DEFAULT 'NORMAL',
    "due_date" DATE,
    "original_due_date" DATE,
    "times_moved" INTEGER NOT NULL DEFAULT 0,
    "highlighted" BOOLEAN NOT NULL DEFAULT false,
    "job_card_id" UUID,
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "completed_by_user_id" UUID,
    "cancelled_at" TIMESTAMPTZ,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_updates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "kind" "TaskUpdateKind" NOT NULL DEFAULT 'NOTE',
    "body" TEXT,
    "language" TEXT,
    "from_status" "TaskStatus",
    "to_status" "TaskStatus",
    "changes" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_updates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tasks_organization_id_idx" ON "tasks"("organization_id");

-- CreateIndex
CREATE INDEX "tasks_organization_id_assignee_employee_id_status_idx" ON "tasks"("organization_id", "assignee_employee_id", "status");

-- CreateIndex
CREATE INDEX "tasks_organization_id_status_due_date_idx" ON "tasks"("organization_id", "status", "due_date");

-- CreateIndex
CREATE INDEX "tasks_organization_id_job_card_id_idx" ON "tasks"("organization_id", "job_card_id");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_organization_id_id_key" ON "tasks"("organization_id", "id");

-- CreateIndex
CREATE INDEX "task_updates_organization_id_task_id_created_at_idx" ON "task_updates"("organization_id", "task_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "task_updates_organization_id_id_key" ON "task_updates"("organization_id", "id");

-- CreateIndex
CREATE INDEX "attendances_organization_id_needs_review_idx" ON "attendances"("organization_id", "needs_review");

-- CreateIndex
CREATE INDEX "documents_organization_id_task_id_idx" ON "documents"("organization_id", "task_id");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_display_token_hash_key" ON "organizations"("display_token_hash");

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_organization_id_reviewed_by_user_id_fkey" FOREIGN KEY ("organization_id", "reviewed_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_task_id_fkey" FOREIGN KEY ("organization_id", "task_id") REFERENCES "tasks"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_assignee_employee_id_fkey" FOREIGN KEY ("organization_id", "assignee_employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_job_card_id_fkey" FOREIGN KEY ("organization_id", "job_card_id") REFERENCES "job_cards"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_created_by_user_id_fkey" FOREIGN KEY ("organization_id", "created_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_completed_by_user_id_fkey" FOREIGN KEY ("organization_id", "completed_by_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_updates" ADD CONSTRAINT "task_updates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_updates" ADD CONSTRAINT "task_updates_organization_id_task_id_fkey" FOREIGN KEY ("organization_id", "task_id") REFERENCES "tasks"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_updates" ADD CONSTRAINT "task_updates_organization_id_author_user_id_fkey" FOREIGN KEY ("organization_id", "author_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A location lock needs both halves of the position, and a sensible radius:
-- under 30 m GPS alone would refuse people standing inside the workshop;
-- over 2 km it no longer says anything about where they are.
ALTER TABLE "branches" ADD CONSTRAINT "branches_position_complete"
  CHECK (("latitude" IS NULL) = ("longitude" IS NULL));
ALTER TABLE "branches" ADD CONSTRAINT "branches_position_range"
  CHECK ("latitude" IS NULL OR ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180));
ALTER TABLE "branches" ADD CONSTRAINT "branches_geofence_radius_range"
  CHECK ("geofence_radius_m" BETWEEN 30 AND 2000);
ALTER TABLE "branches" ADD CONSTRAINT "branches_shift_end_time_format"
  CHECK ("shift_end_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

-- A task always has something to read.
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_title_not_blank" CHECK (length(btrim("title")) > 0);
