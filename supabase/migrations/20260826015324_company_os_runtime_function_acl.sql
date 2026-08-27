-- Trigger execution is owned by the table/trigger path; API roles must not call
-- the guard function directly.
REVOKE ALL ON FUNCTION public.company_os_runtime_guard_work_item_transition()
  FROM PUBLIC, anon, authenticated, service_role;
