-- Company OS Autonomous Engineering V2: allow the dedicated runtime role to
-- evaluate immutable transition predicates invoked by trigger guards.
BEGIN;

GRANT EXECUTE ON FUNCTION public.company_os_engineering_transition_allowed(text, text)
  TO company_os_v3;
GRANT EXECUTE ON FUNCTION public.company_os_engineering_effect_transition_allowed(text, text)
  TO company_os_v3;

COMMIT;
