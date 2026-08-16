BEGIN;

ALTER FUNCTION public.company_os_v3_reject_mutation() SET search_path = '';
ALTER FUNCTION public.company_os_v3_guard_mission_status() SET search_path = '';

COMMIT;
