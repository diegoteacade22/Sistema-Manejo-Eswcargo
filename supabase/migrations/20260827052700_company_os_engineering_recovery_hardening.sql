-- Company OS Autonomous Engineering V2: crash-safe reconciliation hardening.
-- READY_FOR_EFFECT is always recoverable under a fresh fenced lease. This covers
-- crashes before effect reservation, between push and Draft PR, and after all
-- readbacks but before terminal completion. The worker still cannot redispatch an
-- UNKNOWN_OUTCOME: it must read back the remote destination first.

CREATE OR REPLACE FUNCTION public.company_os_engineering_issue_fenced_lease()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  mission_row public."CompanyOsEngineeringMission"%ROWTYPE;
  control_row public."CompanyOsEngineeringControl"%ROWTYPE;
  next_token bigint;
BEGIN
  SELECT * INTO mission_row
  FROM public."CompanyOsEngineeringMission"
  WHERE id = NEW."missionId"
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Engineering mission not found'; END IF;
  SELECT * INTO control_row FROM public."CompanyOsEngineeringControl" WHERE id = 'primary';
  IF NOT FOUND OR control_row."emergencyStop" OR control_row."pauseExecution" THEN
    RAISE EXCEPTION 'Engineering execution is fail-closed';
  END IF;
  IF mission_row.repository = ANY(control_row."quarantinedRepositories")
    OR NEW.actor = ANY(control_row."disabledActors") THEN
    RAISE EXCEPTION 'Engineering capability denied by runtime control';
  END IF;
  IF mission_row.status NOT IN ('READY','READY_FOR_EFFECT') OR mission_row.deadline <= now()
    OR NEW."missionHash" <> mission_row."missionHash" OR NEW.resource <> mission_row.repository
    OR NEW."autonomyLevel" <> mission_row."autonomyLevel" OR NEW."policyHash" <> mission_row."policyHash"
    OR NEW."expectedStateVersion" <> mission_row."stateVersion" OR NEW."budgetUsd" > mission_row."budgetUsd"
    OR NEW.status <> 'ACTIVE' OR NEW."issuedAt" > now() OR NEW."expiresAt" <= now() THEN
    RAISE EXCEPTION 'Engineering capability does not match current mission authority';
  END IF;
  UPDATE public."CompanyOsEngineeringCapabilityLease"
  SET status = 'REVOKED', "revokedAt" = now(), "updatedAt" = now()
  WHERE "missionId" = NEW."missionId" AND status = 'ACTIVE';
  next_token := mission_row."fencingCounter" + 1;
  NEW."fencingToken" := next_token;
  UPDATE public."CompanyOsEngineeringMission"
  SET "fencingCounter" = next_token, "updatedAt" = now()
  WHERE id = NEW."missionId";
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.company_os_engineering_issue_fenced_lease()
  FROM PUBLIC, anon, authenticated, service_role, company_os_reader;
