-- Live change notifications for the workshop board.
--
-- The live board (and the waiting-area TV) no longer re-reads on a timer.
-- Instead, any change to a table it shows sends a tiny notification on the
-- `workshop_live` channel — only which workshop and which table, never the
-- data — and the app pushes "something changed" to the open boards of that
-- workshop, which then re-read once (lib/live/changes.ts).
--
-- Postgres delivers notifications when the transaction commits, and drops
-- identical ones raised in the same transaction, so a check-in that writes
-- several rows of one table still sends one notification.
--
-- No table, column or row changes. Removing it: drop the triggers and the
-- function; the board then simply stops updating by itself.

CREATE OR REPLACE FUNCTION notify_workshop_live() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  org uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    org := OLD.organization_id;
  ELSE
    org := NEW.organization_id;
  END IF;
  PERFORM pg_notify('workshop_live', json_build_object('o', org, 't', TG_TABLE_NAME)::text);
  RETURN NULL;
END;
$$;

CREATE TRIGGER job_cards_notify_live
  AFTER INSERT OR UPDATE OR DELETE ON "job_cards"
  FOR EACH ROW EXECUTE FUNCTION notify_workshop_live();

CREATE TRIGGER appointments_notify_live
  AFTER INSERT OR UPDATE OR DELETE ON "appointments"
  FOR EACH ROW EXECUTE FUNCTION notify_workshop_live();

CREATE TRIGGER job_assignments_notify_live
  AFTER INSERT OR UPDATE OR DELETE ON "job_assignments"
  FOR EACH ROW EXECUTE FUNCTION notify_workshop_live();

CREATE TRIGGER attendances_notify_live
  AFTER INSERT OR UPDATE OR DELETE ON "attendances"
  FOR EACH ROW EXECUTE FUNCTION notify_workshop_live();

CREATE TRIGGER tasks_notify_live
  AFTER INSERT OR UPDATE OR DELETE ON "tasks"
  FOR EACH ROW EXECUTE FUNCTION notify_workshop_live();
