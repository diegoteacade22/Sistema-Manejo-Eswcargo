-- Company OS Autonomous Engineering V2: durable, fail-closed control plane.
-- This migration grants authority only over the five internal engineering tables.
BEGIN;

CREATE TABLE public."CompanyOsEngineeringControl" (
  id text PRIMARY KEY,
  "pauseIntake" boolean NOT NULL DEFAULT true,
  "pauseExecution" boolean NOT NULL DEFAULT true,
  "emergencyStop" boolean NOT NULL DEFAULT true,
  "quarantinedRepositories" text[] NOT NULL DEFAULT '{}'::text[],
  "disabledActors" text[] NOT NULL DEFAULT '{}'::text[],
  "updatedBy" text NOT NULL DEFAULT 'migration',
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public."CompanyOsEngineeringControl" (
  id, "pauseIntake", "pauseExecution", "emergencyStop", "updatedBy"
) VALUES ('primary', true, true, true, 'migration:fail-closed')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE public."CompanyOsEngineeringMission" (
  id text PRIMARY KEY,
  "requestId" text NOT NULL UNIQUE,
  "missionHash" text NOT NULL UNIQUE CHECK ("missionHash" ~ '^[0-9a-f]{64}$'),
  objective text NOT NULL CHECK (length(objective) BETWEEN 1 AND 4000),
  repository text NOT NULL CHECK (length(repository) BETWEEN 1 AND 300),
  "baseCommit" text NOT NULL CHECK ("baseCommit" ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'),
  "allowedPaths" jsonb NOT NULL CHECK (jsonb_typeof("allowedPaths") = 'array'),
  "acceptanceCriteria" jsonb NOT NULL CHECK (jsonb_typeof("acceptanceCriteria") = 'array'),
  "autonomyLevel" text NOT NULL CHECK ("autonomyLevel" IN ('A1','A2')),
  "budgetUsd" numeric(12,6) NOT NULL CHECK ("budgetUsd" >= 0),
  "spentUsd" numeric(12,6) NOT NULL DEFAULT 0 CHECK ("spentUsd" >= 0 AND "spentUsd" <= "budgetUsd"),
  deadline timestamptz NOT NULL,
  "policyHash" text NOT NULL CHECK ("policyHash" ~ '^[0-9a-f]{64}$'),
  "stateVersion" integer NOT NULL DEFAULT 1 CHECK ("stateVersion" > 0),
  "fencingCounter" bigint NOT NULL DEFAULT 0 CHECK ("fencingCounter" >= 0),
  status text NOT NULL DEFAULT 'DISCOVERED' CHECK (status IN (
    'DISCOVERED','TRIAGED','READY','LEASED','RUNNING','VERIFYING','REVIEWING',
    'AWAITING_APPROVAL','READY_FOR_EFFECT','READY_FOR_HUMAN','COMPLETED',
    'BLOCKED_INPUT','BLOCKED_AUTHORITY','FAILED_RETRYABLE','FAILED_FINAL','CANCELLED'
  )),
  "completedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "CompanyOsEngineeringMission_status_createdAt_idx"
  ON public."CompanyOsEngineeringMission" (status, "createdAt");
CREATE INDEX "CompanyOsEngineeringMission_repository_status_createdAt_idx"
  ON public."CompanyOsEngineeringMission" (repository, status, "createdAt");

CREATE TABLE public."CompanyOsEngineeringCapabilityLease" (
  id text PRIMARY KEY,
  "missionId" text NOT NULL REFERENCES public."CompanyOsEngineeringMission"(id) ON DELETE RESTRICT,
  "missionHash" text NOT NULL CHECK ("missionHash" ~ '^[0-9a-f]{64}$'),
  actor text NOT NULL CHECK (length(actor) BETWEEN 1 AND 200),
  resource text NOT NULL CHECK (length(resource) BETWEEN 1 AND 300),
  "allowedVerbs" jsonb NOT NULL CHECK (jsonb_typeof("allowedVerbs") = 'array'),
  "allowedPaths" jsonb NOT NULL CHECK (jsonb_typeof("allowedPaths") = 'array'),
  "autonomyLevel" text NOT NULL CHECK ("autonomyLevel" IN ('A1','A2')),
  "budgetUsd" numeric(12,6) NOT NULL CHECK ("budgetUsd" >= 0),
  "policyHash" text NOT NULL CHECK ("policyHash" ~ '^[0-9a-f]{64}$'),
  "fencingToken" bigint NOT NULL DEFAULT 0 CHECK ("fencingToken" > 0),
  "expectedStateVersion" integer NOT NULL CHECK ("expectedStateVersion" > 0),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED','EXPIRED','RELEASED')),
  "issuedAt" timestamptz NOT NULL DEFAULT now(),
  "expiresAt" timestamptz NOT NULL,
  "revokedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("missionId", "fencingToken"),
  CHECK ("expiresAt" > "issuedAt")
);
CREATE UNIQUE INDEX "CompanyOsEngineeringCapabilityLease_active_mission_key"
  ON public."CompanyOsEngineeringCapabilityLease" ("missionId") WHERE status = 'ACTIVE';
CREATE INDEX "CompanyOsEngineeringCapabilityLease_mission_status_expiresAt_idx"
  ON public."CompanyOsEngineeringCapabilityLease" ("missionId", status, "expiresAt");
CREATE INDEX "CompanyOsEngineeringCapabilityLease_actor_status_expiresAt_idx"
  ON public."CompanyOsEngineeringCapabilityLease" (actor, status, "expiresAt");

CREATE TABLE public."CompanyOsEngineeringEvent" (
  id text PRIMARY KEY,
  "missionId" text NOT NULL REFERENCES public."CompanyOsEngineeringMission"(id) ON DELETE RESTRICT,
  sequence integer NOT NULL CHECK (sequence > 0),
  "eventType" text NOT NULL CHECK (length("eventType") BETWEEN 1 AND 120),
  "fromStatus" text,
  "toStatus" text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  "payloadHash" text NOT NULL CHECK ("payloadHash" ~ '^[0-9a-f]{64}$'),
  "previousHash" text CHECK ("previousHash" IS NULL OR "previousHash" ~ '^[0-9a-f]{64}$'),
  "eventHash" text NOT NULL CHECK ("eventHash" ~ '^[0-9a-f]{64}$'),
  "idempotencyKey" text NOT NULL CHECK (length("idempotencyKey") BETWEEN 8 AND 200),
  "requestHash" text NOT NULL CHECK ("requestHash" ~ '^[0-9a-f]{64}$'),
  "fencingToken" bigint CHECK ("fencingToken" IS NULL OR "fencingToken" > 0),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("missionId", sequence),
  UNIQUE ("missionId", "idempotencyKey")
);
CREATE INDEX "CompanyOsEngineeringEvent_mission_createdAt_idx"
  ON public."CompanyOsEngineeringEvent" ("missionId", "createdAt");
CREATE INDEX "CompanyOsEngineeringEvent_eventType_createdAt_idx"
  ON public."CompanyOsEngineeringEvent" ("eventType", "createdAt");

CREATE TABLE public."CompanyOsEngineeringEffect" (
  id text PRIMARY KEY,
  "missionId" text NOT NULL REFERENCES public."CompanyOsEngineeringMission"(id) ON DELETE RESTRICT,
  "capabilityLeaseId" text NOT NULL REFERENCES public."CompanyOsEngineeringCapabilityLease"(id) ON DELETE RESTRICT,
  "idempotencyKey" text NOT NULL UNIQUE CHECK (length("idempotencyKey") BETWEEN 8 AND 200),
  "requestHash" text NOT NULL CHECK ("requestHash" ~ '^[0-9a-f]{64}$'),
  "missionHash" text NOT NULL CHECK ("missionHash" ~ '^[0-9a-f]{64}$'),
  "targetRepository" text NOT NULL CHECK (length("targetRepository") BETWEEN 1 AND 300),
  verb text NOT NULL CHECK (verb IN ('PUSH_BRANCH','CREATE_DRAFT_PR')),
  "targetBaseBranch" text NOT NULL CHECK (length("targetBaseBranch") BETWEEN 1 AND 200),
  "targetHeadBranch" text NOT NULL CHECK (
    "targetHeadBranch" LIKE 'codex/%'
    AND lower("targetHeadBranch") NOT IN ('codex/main','codex/master','codex/production','codex/prod')
  ),
  "targetCommitSha" text NOT NULL CHECK ("targetCommitSha" ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'),
  "policyHash" text NOT NULL CHECK ("policyHash" ~ '^[0-9a-f]{64}$'),
  "fencingToken" bigint NOT NULL CHECK ("fencingToken" > 0),
  status text NOT NULL DEFAULT 'PLANNED' CHECK (status IN (
    'PLANNED','RESERVED','DISPATCHING','CONFIRMED','FAILED','UNKNOWN_OUTCOME','REVERSED'
  )),
  "remoteProvider" text,
  "remoteId" text,
  "remoteUrl" text,
  "remoteReadbackHash" text CHECK ("remoteReadbackHash" IS NULL OR "remoteReadbackHash" ~ '^[0-9a-f]{64}$'),
  "reservedAt" timestamptz,
  "dispatchStartedAt" timestamptz,
  "confirmedAt" timestamptz,
  "reconciledAt" timestamptz,
  "failedAt" timestamptz,
  "lastErrorCode" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "CompanyOsEngineeringEffect_mission_status_createdAt_idx"
  ON public."CompanyOsEngineeringEffect" ("missionId", status, "createdAt");
CREATE INDEX "CompanyOsEngineeringEffect_status_updatedAt_idx"
  ON public."CompanyOsEngineeringEffect" (status, "updatedAt");
CREATE INDEX "CompanyOsEngineeringEffect_remoteProvider_remoteId_idx"
  ON public."CompanyOsEngineeringEffect" ("remoteProvider", "remoteId");
CREATE UNIQUE INDEX "CompanyOsEngineeringEffect_remote_identity_key"
  ON public."CompanyOsEngineeringEffect" ("remoteProvider", "remoteId")
  WHERE "remoteProvider" IS NOT NULL AND "remoteId" IS NOT NULL;

CREATE OR REPLACE FUNCTION public.company_os_engineering_transition_allowed(old_state text, new_state text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE old_state
    WHEN 'DISCOVERED' THEN new_state IN ('TRIAGED','CANCELLED')
    WHEN 'TRIAGED' THEN new_state IN ('READY','BLOCKED_INPUT','BLOCKED_AUTHORITY','CANCELLED')
    WHEN 'READY' THEN new_state IN ('LEASED','BLOCKED_AUTHORITY','CANCELLED')
    WHEN 'LEASED' THEN new_state IN ('RUNNING','FAILED_RETRYABLE','CANCELLED')
    WHEN 'RUNNING' THEN new_state IN ('VERIFYING','FAILED_RETRYABLE','FAILED_FINAL','BLOCKED_INPUT','BLOCKED_AUTHORITY','CANCELLED')
    WHEN 'VERIFYING' THEN new_state IN ('REVIEWING','READY_FOR_EFFECT','READY_FOR_HUMAN','FAILED_RETRYABLE','FAILED_FINAL','BLOCKED_INPUT')
    WHEN 'REVIEWING' THEN new_state IN ('AWAITING_APPROVAL','READY_FOR_EFFECT','READY_FOR_HUMAN','FAILED_RETRYABLE','FAILED_FINAL','BLOCKED_INPUT')
    WHEN 'AWAITING_APPROVAL' THEN new_state IN ('READY_FOR_EFFECT','BLOCKED_AUTHORITY','CANCELLED')
    WHEN 'READY_FOR_EFFECT' THEN new_state IN ('READY_FOR_HUMAN','COMPLETED','FAILED_RETRYABLE','FAILED_FINAL')
    WHEN 'READY_FOR_HUMAN' THEN new_state IN ('COMPLETED','CANCELLED')
    WHEN 'BLOCKED_INPUT' THEN new_state IN ('READY','CANCELLED')
    WHEN 'BLOCKED_AUTHORITY' THEN new_state IN ('READY','CANCELLED')
    WHEN 'FAILED_RETRYABLE' THEN new_state IN ('READY','FAILED_FINAL','CANCELLED')
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.company_os_engineering_guard_mission()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  control_row public."CompanyOsEngineeringControl"%ROWTYPE;
  latest_event public."CompanyOsEngineeringEvent"%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO control_row FROM public."CompanyOsEngineeringControl" WHERE id = 'primary';
    IF NOT FOUND OR control_row."emergencyStop" OR control_row."pauseIntake" THEN
      RAISE EXCEPTION 'Engineering intake is fail-closed';
    END IF;
    IF NEW.repository = ANY(control_row."quarantinedRepositories") THEN
      RAISE EXCEPTION 'Engineering repository is quarantined';
    END IF;
    IF NEW.status <> 'DISCOVERED' OR NEW."stateVersion" <> 1 OR NEW."fencingCounter" <> 0 THEN
      RAISE EXCEPTION 'Engineering mission must start DISCOVERED at version 1 without fencing authority';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW."requestId" <> OLD."requestId"
    OR NEW."missionHash" <> OLD."missionHash" OR NEW.objective <> OLD.objective
    OR NEW.repository <> OLD.repository OR NEW."baseCommit" <> OLD."baseCommit"
    OR NEW."allowedPaths" <> OLD."allowedPaths" OR NEW."acceptanceCriteria" <> OLD."acceptanceCriteria"
    OR NEW."autonomyLevel" <> OLD."autonomyLevel" OR NEW."budgetUsd" <> OLD."budgetUsd"
    OR NEW.deadline <> OLD.deadline OR NEW."policyHash" <> OLD."policyHash"
    OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'Engineering mission contract is immutable';
  END IF;
  IF NEW."fencingCounter" < OLD."fencingCounter" THEN
    RAISE EXCEPTION 'Engineering fencing counter cannot decrease';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT public.company_os_engineering_transition_allowed(OLD.status, NEW.status) THEN
      RAISE EXCEPTION 'Invalid engineering mission transition: % -> %', OLD.status, NEW.status;
    END IF;
    IF NEW."stateVersion" <> OLD."stateVersion" + 1 THEN
      RAISE EXCEPTION 'Engineering stateVersion must increment exactly once';
    END IF;
    SELECT * INTO latest_event
    FROM public."CompanyOsEngineeringEvent"
    WHERE "missionId" = NEW.id
    ORDER BY sequence DESC
    LIMIT 1;
    IF NOT FOUND OR latest_event."fromStatus" IS DISTINCT FROM OLD.status OR latest_event."toStatus" <> NEW.status THEN
      RAISE EXCEPTION 'Engineering transition requires its append-only event first';
    END IF;
  ELSIF NEW."stateVersion" <> OLD."stateVersion" THEN
    RAISE EXCEPTION 'Engineering stateVersion cannot change without a state transition';
  END IF;
  IF NEW.status = 'COMPLETED' THEN
    IF EXISTS (
      SELECT 1 FROM public."CompanyOsEngineeringEffect"
      WHERE "missionId" = NEW.id AND status <> 'CONFIRMED'
    ) THEN
      RAISE EXCEPTION 'Engineering mission has an unconfirmed or unknown effect';
    END IF;
    IF OLD.status = 'READY_FOR_EFFECT' AND NEW."autonomyLevel" = 'A2' AND NOT EXISTS (
      SELECT 1 FROM public."CompanyOsEngineeringEffect"
      WHERE "missionId" = NEW.id AND status = 'CONFIRMED'
    ) THEN
      RAISE EXCEPTION 'A2 mission cannot complete without a confirmed effect';
    END IF;
    NEW."completedAt" := COALESCE(NEW."completedAt", now());
  ELSIF NEW."completedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'completedAt is valid only for COMPLETED missions';
  END IF;
  NEW."updatedAt" := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER company_os_engineering_mission_guard
BEFORE INSERT OR UPDATE ON public."CompanyOsEngineeringMission"
FOR EACH ROW EXECUTE FUNCTION public.company_os_engineering_guard_mission();

CREATE OR REPLACE FUNCTION public.company_os_engineering_guard_lease_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW."missionId" <> OLD."missionId" OR NEW."missionHash" <> OLD."missionHash"
    OR NEW.actor <> OLD.actor OR NEW.resource <> OLD.resource OR NEW."allowedVerbs" <> OLD."allowedVerbs"
    OR NEW."allowedPaths" <> OLD."allowedPaths" OR NEW."autonomyLevel" <> OLD."autonomyLevel"
    OR NEW."budgetUsd" <> OLD."budgetUsd" OR NEW."policyHash" <> OLD."policyHash"
    OR NEW."fencingToken" <> OLD."fencingToken" OR NEW."expectedStateVersion" <> OLD."expectedStateVersion"
    OR NEW."issuedAt" <> OLD."issuedAt" OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'Engineering capability identity is immutable';
  END IF;
  IF OLD.status = 'ACTIVE' AND NEW.status = 'ACTIVE' THEN
    IF NEW."expiresAt" <= OLD."expiresAt" OR NEW."expiresAt" <= now()
      OR NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt" THEN
      RAISE EXCEPTION 'Invalid engineering capability renewal';
    END IF;
    NEW."updatedAt" := now();
    RETURN NEW;
  END IF;
  IF OLD.status <> 'ACTIVE' OR NEW.status NOT IN ('REVOKED','EXPIRED','RELEASED')
    OR NEW."expiresAt" <> OLD."expiresAt" THEN
    RAISE EXCEPTION 'Invalid engineering capability transition: % -> %', OLD.status, NEW.status;
  END IF;
  NEW."revokedAt" := COALESCE(NEW."revokedAt", now());
  NEW."updatedAt" := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER company_os_engineering_lease_update_guard
BEFORE UPDATE ON public."CompanyOsEngineeringCapabilityLease"
FOR EACH ROW EXECUTE FUNCTION public.company_os_engineering_guard_lease_update();

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
  IF mission_row.status = 'READY_FOR_EFFECT' AND NOT EXISTS (
    SELECT 1 FROM public."CompanyOsEngineeringEffect"
    WHERE "missionId" = mission_row.id AND status = 'UNKNOWN_OUTCOME'
  ) THEN
    RAISE EXCEPTION 'Engineering reconciliation lease requires an unknown effect';
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

CREATE TRIGGER company_os_engineering_issue_fenced_lease
BEFORE INSERT ON public."CompanyOsEngineeringCapabilityLease"
FOR EACH ROW EXECUTE FUNCTION public.company_os_engineering_issue_fenced_lease();

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
          AND NEW."eventType" IN ('ENGINEERING_EFFECT_RESERVED','ENGINEERING_EFFECT_CONFIRMED')
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

CREATE TRIGGER company_os_engineering_event_guard
BEFORE INSERT ON public."CompanyOsEngineeringEvent"
FOR EACH ROW EXECUTE FUNCTION public.company_os_engineering_guard_event();
CREATE TRIGGER company_os_engineering_event_append_only
BEFORE UPDATE OR DELETE ON public."CompanyOsEngineeringEvent"
FOR EACH ROW EXECUTE FUNCTION public.company_os_v3_reject_mutation();

CREATE OR REPLACE FUNCTION public.company_os_engineering_effect_transition_allowed(old_state text, new_state text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE old_state
    WHEN 'PLANNED' THEN new_state IN ('RESERVED','FAILED')
    WHEN 'RESERVED' THEN new_state IN ('DISPATCHING','FAILED')
    WHEN 'DISPATCHING' THEN new_state IN ('CONFIRMED','UNKNOWN_OUTCOME','FAILED')
    WHEN 'UNKNOWN_OUTCOME' THEN new_state IN ('CONFIRMED','FAILED')
    WHEN 'CONFIRMED' THEN new_state = 'REVERSED'
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.company_os_engineering_guard_effect()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  mission_row public."CompanyOsEngineeringMission"%ROWTYPE;
  lease_row public."CompanyOsEngineeringCapabilityLease"%ROWTYPE;
  control_row public."CompanyOsEngineeringControl"%ROWTYPE;
BEGIN
  SELECT * INTO mission_row FROM public."CompanyOsEngineeringMission" WHERE id = NEW."missionId" FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Engineering mission not found'; END IF;
  SELECT * INTO lease_row FROM public."CompanyOsEngineeringCapabilityLease" WHERE id = NEW."capabilityLeaseId";
  IF NOT FOUND THEN RAISE EXCEPTION 'Engineering capability not found'; END IF;
  SELECT * INTO control_row FROM public."CompanyOsEngineeringControl" WHERE id = 'primary';
  IF NOT FOUND THEN RAISE EXCEPTION 'Engineering control is unavailable'; END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PLANNED' OR mission_row.status <> 'READY_FOR_EFFECT' OR mission_row."autonomyLevel" <> 'A2'
      OR NEW."missionHash" <> mission_row."missionHash" OR NEW."targetRepository" <> mission_row.repository
      OR NEW."policyHash" <> mission_row."policyHash" OR NEW."fencingToken" <> mission_row."fencingCounter"
      OR lease_row."missionId" <> mission_row.id OR lease_row."fencingToken" <> mission_row."fencingCounter"
      OR lease_row.status <> 'ACTIVE' OR lease_row."expiresAt" <= now()
      OR control_row."emergencyStop" OR control_row."pauseExecution"
      OR mission_row.repository = ANY(control_row."quarantinedRepositories")
      OR lease_row.actor = ANY(control_row."disabledActors") THEN
      RAISE EXCEPTION 'Engineering effect lacks current A2 authority';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW."missionId" <> OLD."missionId"
    OR NEW."capabilityLeaseId" <> OLD."capabilityLeaseId" OR NEW."idempotencyKey" <> OLD."idempotencyKey"
    OR NEW."requestHash" <> OLD."requestHash" OR NEW."missionHash" <> OLD."missionHash"
    OR NEW."targetRepository" <> OLD."targetRepository" OR NEW.verb <> OLD.verb
    OR NEW."targetBaseBranch" <> OLD."targetBaseBranch" OR NEW."targetHeadBranch" <> OLD."targetHeadBranch"
    OR NEW."targetCommitSha" <> OLD."targetCommitSha" OR NEW."policyHash" <> OLD."policyHash"
    OR NEW."fencingToken" <> OLD."fencingToken" OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'Engineering effect request identity is immutable';
  END IF;
  IF NOT public.company_os_engineering_effect_transition_allowed(OLD.status, NEW.status) THEN
    RAISE EXCEPTION 'Invalid engineering effect transition: % -> %', OLD.status, NEW.status;
  END IF;
  IF NEW.status IN ('RESERVED','DISPATCHING') AND (
    control_row."emergencyStop" OR control_row."pauseExecution"
    OR mission_row.repository = ANY(control_row."quarantinedRepositories")
    OR lease_row.actor = ANY(control_row."disabledActors")
    OR lease_row.status <> 'ACTIVE' OR lease_row."expiresAt" <= now()
    OR NEW."fencingToken" <> mission_row."fencingCounter"
  ) THEN
    RAISE EXCEPTION 'Engineering effect dispatch is stopped or fenced';
  END IF;
  IF NEW.status = 'RESERVED' THEN NEW."reservedAt" := COALESCE(NEW."reservedAt", now()); END IF;
  IF NEW.status = 'DISPATCHING' THEN NEW."dispatchStartedAt" := COALESCE(NEW."dispatchStartedAt", now()); END IF;
  IF NEW.status = 'CONFIRMED' THEN
    IF NEW."remoteProvider" IS NULL OR NEW."remoteId" IS NULL OR NEW."remoteReadbackHash" IS NULL THEN
      RAISE EXCEPTION 'Confirmed engineering effect requires destination readback';
    END IF;
    NEW."confirmedAt" := COALESCE(NEW."confirmedAt", now());
    IF OLD.status = 'UNKNOWN_OUTCOME' THEN NEW."reconciledAt" := COALESCE(NEW."reconciledAt", now()); END IF;
  END IF;
  IF NEW.status = 'UNKNOWN_OUTCOME' THEN
    NEW."reconciledAt" := NULL;
  END IF;
  IF NEW.status = 'FAILED' THEN NEW."failedAt" := COALESCE(NEW."failedAt", now()); END IF;
  NEW."updatedAt" := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER company_os_engineering_effect_guard
BEFORE INSERT OR UPDATE ON public."CompanyOsEngineeringEffect"
FOR EACH ROW EXECUTE FUNCTION public.company_os_engineering_guard_effect();

DO $$
DECLARE relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'CompanyOsEngineeringMission','CompanyOsEngineeringCapabilityLease',
    'CompanyOsEngineeringEvent','CompanyOsEngineeringEffect','CompanyOsEngineeringControl'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', relation_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', relation_name);
    EXECUTE format(
      'REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role, company_os_reader',
      relation_name
    );
    EXECUTE format(
      'CREATE POLICY company_os_engineering_select ON public.%I FOR SELECT TO company_os_v3 USING (true)',
      relation_name
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON public."CompanyOsEngineeringMission" TO company_os_v3;
GRANT SELECT, INSERT, UPDATE ON public."CompanyOsEngineeringCapabilityLease" TO company_os_v3;
GRANT SELECT, INSERT ON public."CompanyOsEngineeringEvent" TO company_os_v3;
GRANT SELECT, INSERT, UPDATE ON public."CompanyOsEngineeringEffect" TO company_os_v3;
GRANT SELECT, UPDATE ON public."CompanyOsEngineeringControl" TO company_os_v3;

CREATE POLICY company_os_engineering_mission_insert ON public."CompanyOsEngineeringMission"
  FOR INSERT TO company_os_v3 WITH CHECK (true);
CREATE POLICY company_os_engineering_mission_update ON public."CompanyOsEngineeringMission"
  FOR UPDATE TO company_os_v3 USING (true) WITH CHECK (true);
CREATE POLICY company_os_engineering_lease_insert ON public."CompanyOsEngineeringCapabilityLease"
  FOR INSERT TO company_os_v3 WITH CHECK (true);
CREATE POLICY company_os_engineering_lease_update ON public."CompanyOsEngineeringCapabilityLease"
  FOR UPDATE TO company_os_v3 USING (true) WITH CHECK (true);
CREATE POLICY company_os_engineering_event_insert ON public."CompanyOsEngineeringEvent"
  FOR INSERT TO company_os_v3 WITH CHECK (true);
CREATE POLICY company_os_engineering_effect_insert ON public."CompanyOsEngineeringEffect"
  FOR INSERT TO company_os_v3 WITH CHECK (true);
CREATE POLICY company_os_engineering_effect_update ON public."CompanyOsEngineeringEffect"
  FOR UPDATE TO company_os_v3 USING (true) WITH CHECK (true);
CREATE POLICY company_os_engineering_control_update ON public."CompanyOsEngineeringControl"
  FOR UPDATE TO company_os_v3 USING (true) WITH CHECK (true);

REVOKE ALL ON FUNCTION public.company_os_engineering_transition_allowed(text, text)
  FROM PUBLIC, anon, authenticated, service_role, company_os_reader;
REVOKE ALL ON FUNCTION public.company_os_engineering_guard_mission()
  FROM PUBLIC, anon, authenticated, service_role, company_os_reader;
REVOKE ALL ON FUNCTION public.company_os_engineering_guard_lease_update()
  FROM PUBLIC, anon, authenticated, service_role, company_os_reader;
REVOKE ALL ON FUNCTION public.company_os_engineering_issue_fenced_lease()
  FROM PUBLIC, anon, authenticated, service_role, company_os_reader;
REVOKE ALL ON FUNCTION public.company_os_engineering_guard_event()
  FROM PUBLIC, anon, authenticated, service_role, company_os_reader;
REVOKE ALL ON FUNCTION public.company_os_engineering_effect_transition_allowed(text, text)
  FROM PUBLIC, anon, authenticated, service_role, company_os_reader;
REVOKE ALL ON FUNCTION public.company_os_engineering_guard_effect()
  FROM PUBLIC, anon, authenticated, service_role, company_os_reader;

COMMIT;
