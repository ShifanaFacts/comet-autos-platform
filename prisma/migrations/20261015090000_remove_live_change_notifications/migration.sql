-- Removes the live change notifications added in
-- 20261014090000_live_change_notifications.
--
-- The live board now loads its data when it is opened, like every other
-- screen, instead of being told about changes; nothing listens on the
-- `workshop_live` channel any more. No table, column or row changes.

DROP TRIGGER IF EXISTS job_cards_notify_live ON "job_cards";
DROP TRIGGER IF EXISTS appointments_notify_live ON "appointments";
DROP TRIGGER IF EXISTS job_assignments_notify_live ON "job_assignments";
DROP TRIGGER IF EXISTS attendances_notify_live ON "attendances";
DROP TRIGGER IF EXISTS tasks_notify_live ON "tasks";

DROP FUNCTION IF EXISTS notify_workshop_live();
