-- Company OS Autonomous Engineering V2: durable proof events.
-- These are same-state security observations, never authority transitions.

CREATE OR REPLACE FUNCTION public.company_os_engineering_guard_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  mission_row public."CompanyOsEngineeringMission"%ROWTYPE;
  previous_event public."CompanyOsEngineeringEvent"%ROWTYPE;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('engineering-event:' || NEW."missionId", 0));
  SELECT * INTO mission_row FROM public."CompanyOsEngineeringMission" WHERE id = NEW."missionId" FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Engineering mission not found'; END IF;
  SELECT * INTO previous_event
  FROM public."CompanyOsEngineeringEvent"
  WHERE "missionId" = NEW."missionId"
  ORDER BY sequence DESC
  LIMIT 1;
  IF NOT FOUND THEN
    IF NEW.sequence <> 1 OR NEW."previousHash" IS NOT NULL OR NEW."fromStatus" IS NOT NULL
      OR NEW."toStatus" <> 'DISCOVERED' OR mission_row.status <> 'DISCOVERED' THEN
      RAISE EXCEPTION 'Invalid first engineering event';
    END IF;
  ELSE
    IF NEW.sequence <> previous_event.sequence + 1 OR NEW."previousHash" <> previous_event."eventHash"
      OR NEW."fromStatus" <> previous_event."toStatus" OR NEW."fromStatus" <> mission_row.status
      OR NOT (
        public.company_os_engineering_transition_allowed(NEW."fromStatus", NEW."toStatus")
        OR (
          NEW."fromStatus" = NEW."toStatus"
          AND NEW."eventType" IN (
            'ENGINEERING_EFFECT_RESERVED',
            'ENGINEERING_EFFECT_CONFIRMED',
            'UNKNOWN_OUTCOME_RECONCILED',
            'STALE_FENCE_REJECTED',
            'EMERGENCY_STOP_VERIFIED'
          )
        )
      ) THEN
      RAISE EXCEPTION 'Engineering event chain or transition is invalid';
    END IF;
  END IF;
  IF NEW."fencingToken" IS NOT NULL AND NEW."fencingToken" <> mission_row."fencingCounter" THEN
    RAISE EXCEPTION 'Engineering event uses a stale fencing token';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.company_os_engineering_guard_event()
  FROM PUBLIC, anon, authenticated, service_role, company_os_reader;
