-- The audit log is read-only forever: rows are only ever added. Like the
-- journal, a mistake is never corrected by changing the record of it — and
-- nobody, the application included, can edit or delete what was logged.
CREATE FUNCTION audit_log_is_permanent() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'The audit log is permanent: its entries can''t be changed or deleted.';
END;
$$;

CREATE TRIGGER audit_logs_permanent
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_log_is_permanent();

CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_is_permanent();
