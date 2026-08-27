-- Systems Manager V1 hardening: human review vocabulary and a separately testable least-privilege role.

ALTER TABLE public."CompanyOsUsage"
  ADD COLUMN IF NOT EXISTS "responseId" text,
  ADD COLUMN IF NOT EXISTS "durationMs" integer CHECK ("durationMs" IS NULL OR "durationMs" >= 0),
  ADD COLUMN IF NOT EXISTS retries integer NOT NULL DEFAULT 0 CHECK (retries >= 0),
  ADD COLUMN IF NOT EXISTS "snapshotBytes" integer CHECK ("snapshotBytes" IS NULL OR "snapshotBytes" >= 0),
  ADD COLUMN IF NOT EXISTS "rulesApplied" jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$ DECLARE constraint_name text; BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public."CompanyOsDecision"'::regclass
    AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%decision%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public."CompanyOsDecision" DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE public."CompanyOsDecision"
  ADD CONSTRAINT "CompanyOsDecision_decision_human_review_check"
  CHECK (decision IN ('APPROVE','REJECT','REQUEST_REVIEW','BLOCK','EDIT','POSTPONE','MARK_INCORRECT'));

CREATE OR REPLACE FUNCTION public.company_os_v3_guard_mission_status() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE allowed boolean;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status <> 'PLANNED' THEN
    RAISE EXCEPTION 'Company OS V3 missions must start PLANNED';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IN ('RUNNING','DONE') THEN RAISE EXCEPTION 'Company OS V3 cannot execute missions'; END IF;
    SELECT EXISTS (
      SELECT 1 FROM public."CompanyOsDecision" d
      WHERE d."missionId" = NEW.id AND d."caseId" = NEW."caseId"
        AND ((NEW.status = 'APPROVED' AND d.decision = 'APPROVE')
          OR (NEW.status = 'REJECTED' AND d.decision = 'REJECT')
          OR (NEW.status = 'REVIEW' AND d.decision IN ('REQUEST_REVIEW','EDIT','POSTPONE'))
          OR (NEW.status = 'BLOCKED' AND d.decision IN ('BLOCK','MARK_INCORRECT')))
    ) INTO allowed;
    IF NOT allowed THEN RAISE EXCEPTION 'Mission transition lacks a matching human decision'; END IF;
  END IF;
  RETURN NEW;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'systems_manager_ai_v1') THEN
    CREATE ROLE systems_manager_ai_v1 NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO systems_manager_ai_v1;
GRANT SELECT ON public."CompanyOsCase", public."CompanyOsMessage", public."CompanyOsCaseEvent",
  public."CompanyOsEvidenceRef", public."CompanyOsMission", public."CompanyOsDecision",
  public."CompanyOsAuditEvent", public."CompanyOsUsage", public."CompanyOsHeartbeat",
  public."CompanyOsExecutionAttempt", public."CompanyOsNotificationDelivery",
  public."CompanyOsSystemSnapshot", public."CompanyOsSystemAsset", public."CompanyOsSystemDependency",
  public."CompanyOsSystemHealthObservation", public."CompanyOsSystemCoverageObservation",
  public."CompanyOsSystemRisk", public."CompanyOsSystemRiskHistory", public."CompanyOsAgentSchedule"
TO systems_manager_ai_v1;
GRANT INSERT ON public."CompanyOsSystemRiskHistory" TO systems_manager_ai_v1;

CREATE POLICY systems_manager_ai_v1_case_select ON public."CompanyOsCase"
  FOR SELECT TO systems_manager_ai_v1 USING ("agentId" = 'systems-manager-ai-v1');
CREATE POLICY systems_manager_ai_v1_schedule_select ON public."CompanyOsAgentSchedule"
  FOR SELECT TO systems_manager_ai_v1 USING ("agentId" = 'systems-manager-ai-v1');
CREATE POLICY systems_manager_ai_v1_audit_select ON public."CompanyOsAuditEvent"
  FOR SELECT TO systems_manager_ai_v1 USING (
    EXISTS (SELECT 1 FROM public."CompanyOsCase" c WHERE c."requestId" = "CompanyOsAuditEvent"."requestId" AND c."agentId" = 'systems-manager-ai-v1')
  );

DO $$ DECLARE relation_name text; BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'CompanyOsMessage','CompanyOsCaseEvent','CompanyOsEvidenceRef','CompanyOsMission','CompanyOsDecision',
    'CompanyOsUsage','CompanyOsHeartbeat','CompanyOsExecutionAttempt','CompanyOsNotificationDelivery',
    'CompanyOsSystemSnapshot','CompanyOsSystemAsset','CompanyOsSystemDependency',
    'CompanyOsSystemHealthObservation','CompanyOsSystemCoverageObservation','CompanyOsSystemRisk','CompanyOsSystemRiskHistory'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY systems_manager_ai_v1_case_select ON public.%I FOR SELECT TO systems_manager_ai_v1 '
      'USING (EXISTS (SELECT 1 FROM public."CompanyOsCase" c WHERE c.id = "caseId" AND c."agentId" = ''systems-manager-ai-v1''))',
      relation_name
    );
  END LOOP;
END $$;

CREATE POLICY systems_manager_ai_v1_risk_history_insert ON public."CompanyOsSystemRiskHistory"
  FOR INSERT TO systems_manager_ai_v1 WITH CHECK (
    EXISTS (SELECT 1 FROM public."CompanyOsCase" c WHERE c.id = "caseId" AND c."agentId" = 'systems-manager-ai-v1')
  );

REVOKE INSERT, UPDATE, DELETE ON public."CompanyOsAgentSchedule" FROM systems_manager_ai_v1;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM systems_manager_ai_v1;
-- Re-grant only the explicit observational surface after the broad defensive revoke.
GRANT SELECT ON public."CompanyOsCase", public."CompanyOsMessage", public."CompanyOsCaseEvent",
  public."CompanyOsEvidenceRef", public."CompanyOsMission", public."CompanyOsDecision",
  public."CompanyOsAuditEvent", public."CompanyOsUsage", public."CompanyOsHeartbeat",
  public."CompanyOsExecutionAttempt", public."CompanyOsNotificationDelivery",
  public."CompanyOsSystemSnapshot", public."CompanyOsSystemAsset", public."CompanyOsSystemDependency",
  public."CompanyOsSystemHealthObservation", public."CompanyOsSystemCoverageObservation",
  public."CompanyOsSystemRisk", public."CompanyOsSystemRiskHistory", public."CompanyOsAgentSchedule"
TO systems_manager_ai_v1;
GRANT INSERT ON public."CompanyOsSystemRiskHistory" TO systems_manager_ai_v1;

REVOKE ALL ON FUNCTION public.company_os_v3_guard_mission_status() FROM PUBLIC;
