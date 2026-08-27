-- Recovery claims are valid only after the retry backoff selected by runtime-store.
-- Rollback: restore the prior function body with FAILED_RETRYABLE limited to
-- ('QUEUED','FAILED_FINAL','BLOCKED','CANCELLED').
CREATE OR REPLACE FUNCTION public.company_os_runtime_guard_work_item_transition() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NOT (
    (OLD.status = 'QUEUED' AND NEW.status IN ('CLAIMED','BLOCKED','FAILED_FINAL','CANCELLED')) OR
    (OLD.status = 'CLAIMED' AND NEW.status IN ('RUNNING','QUEUED','FAILED_RETRYABLE','FAILED_FINAL','BLOCKED','CANCELLED')) OR
    (OLD.status = 'RUNNING' AND NEW.status IN ('NEEDS_REVIEW','COMPLETED','FAILED_RETRYABLE','FAILED_FINAL','BLOCKED','CANCELLED')) OR
    (OLD.status = 'FAILED_RETRYABLE' AND NEW.status IN ('QUEUED','CLAIMED','FAILED_FINAL','BLOCKED','CANCELLED')) OR
    (OLD.status = 'NEEDS_REVIEW' AND NEW.status IN ('COMPLETED','BLOCKED','CANCELLED')) OR
    (OLD.status = 'BLOCKED' AND NEW.status IN ('QUEUED','FAILED_FINAL','CANCELLED')) OR
    (OLD.status = 'FAILED_FINAL' AND NEW.status = 'QUEUED')
  ) THEN
    RAISE EXCEPTION 'Invalid Company OS work item transition: % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.company_os_runtime_guard_work_item_transition() FROM PUBLIC;
