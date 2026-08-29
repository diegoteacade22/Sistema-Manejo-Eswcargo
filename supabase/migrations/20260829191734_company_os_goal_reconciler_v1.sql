-- Company OS Goal Reconciler V1.
-- Durable desired-state goals remain human-authored. The signed engineering
-- worker may only append observations; it cannot grant itself new authority.
BEGIN;

CREATE TABLE public."CompanyOsEngineeringGoal" (
  id text PRIMARY KEY CHECK (
    length(id) BETWEEN 8 AND 180
    AND id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,179}$'
  ),
  "goalKey" text NOT NULL CHECK (length("goalKey") BETWEEN 1 AND 120),
  version integer NOT NULL CHECK (version > 0),
  "sourceKind" text NOT NULL CHECK ("sourceKind" = 'REPOSITORY_DOCUMENT'),
  "sourceRef" text NOT NULL CHECK (length("sourceRef") BETWEEN 1 AND 500),
  "sourceHash" text NOT NULL CHECK ("sourceHash" ~ '^[0-9a-f]{64}$'),
  objective text NOT NULL CHECK (length(objective) BETWEEN 1 AND 4000),
  repository text NOT NULL CHECK (length(repository) BETWEEN 1 AND 300),
  "baseBranch" text NOT NULL CHECK (length("baseBranch") BETWEEN 1 AND 200),
  "desiredState" jsonb NOT NULL CHECK (jsonb_typeof("desiredState") = 'object'),
  "allowedPaths" jsonb NOT NULL CHECK (jsonb_typeof("allowedPaths") = 'array'),
  "acceptanceCriteria" jsonb NOT NULL CHECK (jsonb_typeof("acceptanceCriteria") = 'array'),
  "autonomyLevel" text NOT NULL CHECK ("autonomyLevel" IN ('A1','A2')),
  "budgetUsd" numeric(12,6) NOT NULL CHECK ("budgetUsd" > 0 AND "budgetUsd" <= 10),
  "missionTtlMinutes" integer NOT NULL CHECK ("missionTtlMinutes" BETWEEN 5 AND 1440),
  "policyHash" text NOT NULL CHECK ("policyHash" ~ '^[0-9a-f]{64}$'),
  priority integer NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 100),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAUSED','COMPLETED')),
  "createdBy" text NOT NULL CHECK (length("createdBy") BETWEEN 1 AND 200),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("goalKey", version)
);

CREATE INDEX "CompanyOsEngineeringGoal_status_priority_createdAt_idx"
  ON public."CompanyOsEngineeringGoal" (status, priority DESC, "createdAt");
CREATE UNIQUE INDEX "CompanyOsEngineeringGoal_one_active_version_key"
  ON public."CompanyOsEngineeringGoal" ("goalKey") WHERE status = 'ACTIVE';

ALTER TABLE public."CompanyOsEngineeringMission"
  ADD COLUMN "goalId" text,
  ADD COLUMN "contractVersion" text NOT NULL DEFAULT '2.0.0'
    CHECK ("contractVersion" IN ('2.0.0','2.1.0')),
  ADD COLUMN "desiredState" jsonb CHECK ("desiredState" IS NULL OR jsonb_typeof("desiredState") = 'object'),
  ADD COLUMN "attemptCount" integer NOT NULL DEFAULT 0 CHECK ("attemptCount" BETWEEN 0 AND 3),
  ADD COLUMN "maxAttempts" integer NOT NULL DEFAULT 3 CHECK ("maxAttempts" BETWEEN 1 AND 3),
  ADD COLUMN "nextAttemptAt" timestamptz NOT NULL DEFAULT now();

-- Existing terminal or overdue missions may have deadlines before the
-- migration timestamp. Keep those rows updateable by the replacement guard so
-- cleanup can still move them to a terminal state.
UPDATE public."CompanyOsEngineeringMission"
SET "nextAttemptAt" = LEAST("nextAttemptAt", deadline)
WHERE "nextAttemptAt" > deadline;

ALTER TABLE public."CompanyOsEngineeringMission"
  ADD CONSTRAINT "CompanyOsEngineeringMission_goalId_fkey"
  FOREIGN KEY ("goalId") REFERENCES public."CompanyOsEngineeringGoal"(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX "CompanyOsEngineeringMission_one_effective_goal_key"
  ON public."CompanyOsEngineeringMission" ("goalId")
  WHERE "goalId" IS NOT NULL AND status NOT IN ('COMPLETED','FAILED_FINAL','CANCELLED');
CREATE INDEX "CompanyOsEngineeringMission_goalId_idx"
  ON public."CompanyOsEngineeringMission" ("goalId");
CREATE INDEX "CompanyOsEngineeringMission_retry_due_idx"
  ON public."CompanyOsEngineeringMission" (status, "nextAttemptAt", deadline);

CREATE OR REPLACE FUNCTION public.company_os_engineering_transition_allowed(old_state text, new_state text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE old_state
    WHEN 'DISCOVERED' THEN new_state IN ('TRIAGED','CANCELLED')
    WHEN 'TRIAGED' THEN new_state IN ('READY','BLOCKED_INPUT','BLOCKED_AUTHORITY','CANCELLED')
    WHEN 'READY' THEN new_state IN ('LEASED','FAILED_FINAL','BLOCKED_AUTHORITY','CANCELLED')
    WHEN 'LEASED' THEN new_state IN ('RUNNING','FAILED_RETRYABLE','FAILED_FINAL','CANCELLED')
    WHEN 'RUNNING' THEN new_state IN ('VERIFYING','FAILED_RETRYABLE','FAILED_FINAL','BLOCKED_INPUT','BLOCKED_AUTHORITY','CANCELLED')
    WHEN 'VERIFYING' THEN new_state IN ('REVIEWING','READY_FOR_EFFECT','READY_FOR_HUMAN','FAILED_RETRYABLE','FAILED_FINAL','BLOCKED_INPUT')
    WHEN 'REVIEWING' THEN new_state IN ('AWAITING_APPROVAL','READY_FOR_EFFECT','READY_FOR_HUMAN','FAILED_RETRYABLE','FAILED_FINAL','BLOCKED_INPUT')
    WHEN 'AWAITING_APPROVAL' THEN new_state IN ('READY_FOR_EFFECT','BLOCKED_AUTHORITY','CANCELLED')
    WHEN 'READY_FOR_EFFECT' THEN new_state IN ('READY_FOR_HUMAN','COMPLETED','FAILED_RETRYABLE','FAILED_FINAL')
    WHEN 'READY_FOR_HUMAN' THEN new_state IN ('COMPLETED','CANCELLED')
    WHEN 'COMPLETED' THEN false
    WHEN 'BLOCKED_INPUT' THEN new_state IN ('READY','CANCELLED')
    WHEN 'BLOCKED_AUTHORITY' THEN new_state IN ('READY','CANCELLED')
    WHEN 'FAILED_RETRYABLE' THEN new_state IN ('READY','FAILED_FINAL','CANCELLED')
    WHEN 'FAILED_FINAL' THEN false
    WHEN 'CANCELLED' THEN false
    ELSE false
  END
$$;

-- The original mission trigger remains the final authority for intake,
-- immutable mission contracts, event-before-state transitions, fencing and
-- completion readback. V1 extends that complete guard instead of layering a
-- second trigger whose execution order could weaken those guarantees.
CREATE OR REPLACE FUNCTION public.company_os_engineering_guard_mission()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  control_row public."CompanyOsEngineeringControl"%ROWTYPE;
  latest_event public."CompanyOsEngineeringEvent"%ROWTYPE;
  goal_row public."CompanyOsEngineeringGoal"%ROWTYPE;
BEGIN
  IF (NEW."goalId" IS NULL) IS DISTINCT FROM (NEW."desiredState" IS NULL) THEN
    RAISE EXCEPTION 'Engineering goalId and desiredState must be present together';
  END IF;
  IF NEW."attemptCount" > NEW."maxAttempts" THEN
    RAISE EXCEPTION 'Engineering attemptCount cannot exceed maxAttempts';
  END IF;
  IF NEW."nextAttemptAt" > NEW.deadline THEN
    RAISE EXCEPTION 'Engineering nextAttemptAt cannot exceed deadline';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT * INTO control_row
    FROM public."CompanyOsEngineeringControl"
    WHERE id = 'primary';
    IF NOT FOUND OR control_row."emergencyStop" OR control_row."pauseIntake" THEN
      RAISE EXCEPTION 'Engineering intake is fail-closed';
    END IF;
    IF NEW.repository = ANY(control_row."quarantinedRepositories") THEN
      RAISE EXCEPTION 'Engineering repository is quarantined';
    END IF;
    IF NEW.status <> 'DISCOVERED' OR NEW."stateVersion" <> 1 OR NEW."fencingCounter" <> 0 THEN
      RAISE EXCEPTION 'Engineering mission must start DISCOVERED at version 1 without fencing authority';
    END IF;
    IF NEW."attemptCount" <> 0 THEN
      RAISE EXCEPTION 'Engineering mission must start without attempts';
    END IF;

    -- A manual mission has no GoalSpec and therefore no desired state. A
    -- goal-linked mission is accepted only from the exact active immutable
    -- GoalSpec that granted its bounded authority.
    IF NEW."goalId" IS NOT NULL THEN
      SELECT * INTO goal_row
      FROM public."CompanyOsEngineeringGoal"
      WHERE id = NEW."goalId";
      IF NOT FOUND OR goal_row.status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Engineering goal-linked mission requires an ACTIVE GoalSpec';
      END IF;
      IF NEW."contractVersion" <> '2.1.0'
        OR NEW.repository IS DISTINCT FROM goal_row.repository
        OR NEW."allowedPaths" IS DISTINCT FROM goal_row."allowedPaths"
        OR NEW."acceptanceCriteria" IS DISTINCT FROM goal_row."acceptanceCriteria"
        OR NEW."desiredState" IS DISTINCT FROM goal_row."desiredState"
        OR NEW."autonomyLevel" IS DISTINCT FROM goal_row."autonomyLevel"
        OR NEW."budgetUsd" IS DISTINCT FROM goal_row."budgetUsd"
        OR NEW."policyHash" IS DISTINCT FROM goal_row."policyHash" THEN
        RAISE EXCEPTION 'Engineering goal-linked mission does not mirror its ACTIVE GoalSpec';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id OR NEW."requestId" IS DISTINCT FROM OLD."requestId"
    OR NEW."missionHash" IS DISTINCT FROM OLD."missionHash" OR NEW.objective IS DISTINCT FROM OLD.objective
    OR NEW.repository IS DISTINCT FROM OLD.repository OR NEW."baseCommit" IS DISTINCT FROM OLD."baseCommit"
    OR NEW."allowedPaths" IS DISTINCT FROM OLD."allowedPaths"
    OR NEW."acceptanceCriteria" IS DISTINCT FROM OLD."acceptanceCriteria"
    OR NEW."autonomyLevel" IS DISTINCT FROM OLD."autonomyLevel"
    OR NEW."budgetUsd" IS DISTINCT FROM OLD."budgetUsd"
    OR NEW.deadline IS DISTINCT FROM OLD.deadline OR NEW."policyHash" IS DISTINCT FROM OLD."policyHash"
    OR NEW."goalId" IS DISTINCT FROM OLD."goalId"
    OR NEW."contractVersion" IS DISTINCT FROM OLD."contractVersion"
    OR NEW."desiredState" IS DISTINCT FROM OLD."desiredState"
    OR NEW."maxAttempts" IS DISTINCT FROM OLD."maxAttempts"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'Engineering mission contract is immutable';
  END IF;
  IF NEW."fencingCounter" < OLD."fencingCounter" THEN
    RAISE EXCEPTION 'Engineering fencing counter cannot decrease';
  END IF;
  IF NEW."attemptCount" < OLD."attemptCount"
    OR NEW."attemptCount" > OLD."attemptCount" + 1 THEN
    RAISE EXCEPTION 'Engineering attemptCount must be monotonic and increment at most once';
  END IF;
  IF NEW."attemptCount" = OLD."attemptCount" + 1
    AND (OLD.status NOT IN ('READY','READY_FOR_EFFECT') OR NEW.status <> OLD.status) THEN
    RAISE EXCEPTION 'Engineering attemptCount may increment only while a claimable mission remains ready';
  END IF;
  IF NEW."nextAttemptAt" IS DISTINCT FROM OLD."nextAttemptAt" THEN
    IF OLD.status <> 'FAILED_RETRYABLE' OR NEW.status <> 'FAILED_RETRYABLE'
      OR NEW."nextAttemptAt" <= OLD."nextAttemptAt"
      OR NEW."nextAttemptAt" <= now()
      OR NEW."nextAttemptAt" >= NEW.deadline THEN
      RAISE EXCEPTION 'Engineering retry deadline is inconsistent with FAILED_RETRYABLE';
    END IF;
    SELECT * INTO latest_event
    FROM public."CompanyOsEngineeringEvent"
    WHERE "missionId" = NEW.id
    ORDER BY sequence DESC
    LIMIT 1;
    IF NOT FOUND OR latest_event."eventType" NOT IN (
        'ENGINEERING_MISSION_FAILED',
        'LEASE_EXPIRED_RECOVERY',
        'ORPHANED_LEASE_RECOVERY',
        'EMERGENCY_STOP_RECOVERY',
        'EXECUTION_PAUSED_RECOVERY'
      )
      OR latest_event."toStatus" <> 'FAILED_RETRYABLE' THEN
      RAISE EXCEPTION 'Engineering retry deadline requires its failure event first';
    END IF;
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
    IF NOT FOUND OR latest_event."fromStatus" IS DISTINCT FROM OLD.status
      OR latest_event."toStatus" <> NEW.status THEN
      RAISE EXCEPTION 'Engineering transition requires its append-only event first';
    END IF;
    IF NEW.status = 'FAILED_RETRYABLE'
      AND latest_event."eventType" NOT IN (
        'ENGINEERING_MISSION_FAILED',
        'LEASE_EXPIRED_RECOVERY',
        'ORPHANED_LEASE_RECOVERY',
        'EMERGENCY_STOP_RECOVERY',
        'EXECUTION_PAUSED_RECOVERY'
      ) THEN
      RAISE EXCEPTION 'Engineering FAILED_RETRYABLE requires its failure event first';
    END IF;
    IF OLD.status = 'FAILED_RETRYABLE' AND NEW.status = 'READY'
      AND OLD."nextAttemptAt" > now() THEN
      RAISE EXCEPTION 'Engineering retry cannot become READY before nextAttemptAt';
    END IF;
  ELSIF NEW."stateVersion" <> OLD."stateVersion" THEN
    RAISE EXCEPTION 'Engineering stateVersion cannot change without a state transition';
  END IF;

  IF NEW.status = 'COMPLETED' THEN
    IF EXISTS (
      SELECT 1
      FROM public."CompanyOsEngineeringEffect"
      WHERE "missionId" = NEW.id AND status NOT IN ('CONFIRMED','FAILED')
    ) THEN
      RAISE EXCEPTION 'Engineering mission has an unconfirmed or unknown effect';
    END IF;
    IF NEW."autonomyLevel" = 'A2' AND NOT EXISTS (
      SELECT 1
      FROM public."CompanyOsEngineeringEffect"
      WHERE "missionId" = NEW.id AND verb = 'PUSH_BRANCH' AND status = 'CONFIRMED'
    ) THEN
      RAISE EXCEPTION 'A2 mission cannot complete without a confirmed branch';
    END IF;
    IF NEW."autonomyLevel" = 'A2' AND NOT EXISTS (
      SELECT 1
      FROM public."CompanyOsEngineeringEffect"
      WHERE "missionId" = NEW.id AND verb = 'CREATE_DRAFT_PR' AND status = 'CONFIRMED'
    ) THEN
      RAISE EXCEPTION 'A2 mission cannot complete without a confirmed Draft PR';
    END IF;
    NEW."completedAt" := COALESCE(NEW."completedAt", now());
  ELSIF NEW."completedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'completedAt is valid only for COMPLETED missions';
  END IF;
  NEW."updatedAt" := now();
  RETURN NEW;
END;
$$;

-- Reassert the complete same-state proof-event allowlist in this contract
-- migration. Reconciliation of an UNKNOWN remote outcome is intentionally an
-- observation while the mission stays READY_FOR_EFFECT; rejecting that event
-- would roll back the effect confirmation in the same transaction.
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
  SELECT * INTO mission_row
  FROM public."CompanyOsEngineeringMission"
  WHERE id = NEW."missionId"
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Engineering mission not found';
  END IF;
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
    IF NEW.sequence <> previous_event.sequence + 1
      OR NEW."previousHash" <> previous_event."eventHash"
      OR NEW."fromStatus" <> previous_event."toStatus"
      OR NEW."fromStatus" <> mission_row.status
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
  IF NEW."fencingToken" IS NOT NULL
    AND NEW."fencingToken" <> mission_row."fencingCounter" THEN
    RAISE EXCEPTION 'Engineering event uses a stale fencing token';
  END IF;
  RETURN NEW;
END;
$$;

-- Defense in depth: even a compromised application role cannot reserve a
-- remote effect whose verb or path authority was not present in the exact
-- fenced lease issued for the mission.
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
  SELECT * INTO mission_row
  FROM public."CompanyOsEngineeringMission"
  WHERE id = NEW."missionId"
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Engineering mission not found'; END IF;
  SELECT * INTO lease_row
  FROM public."CompanyOsEngineeringCapabilityLease"
  WHERE id = NEW."capabilityLeaseId";
  IF NOT FOUND THEN RAISE EXCEPTION 'Engineering capability not found'; END IF;
  SELECT * INTO control_row
  FROM public."CompanyOsEngineeringControl"
  WHERE id = 'primary';
  IF NOT FOUND THEN RAISE EXCEPTION 'Engineering control is unavailable'; END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PLANNED'
      OR mission_row.status <> 'READY_FOR_EFFECT'
      OR mission_row."autonomyLevel" <> 'A2'
      OR NEW."missionHash" <> mission_row."missionHash"
      OR NEW."targetRepository" <> mission_row.repository
      OR NEW."policyHash" <> mission_row."policyHash"
      OR NEW."fencingToken" <> mission_row."fencingCounter"
      OR lease_row."missionId" <> mission_row.id
      OR lease_row."fencingToken" <> mission_row."fencingCounter"
      OR lease_row."missionHash" <> mission_row."missionHash"
      OR lease_row."policyHash" <> mission_row."policyHash"
      OR lease_row.resource <> mission_row.repository
      OR lease_row."autonomyLevel" <> mission_row."autonomyLevel"
      OR lease_row."allowedPaths" <> mission_row."allowedPaths"
      OR NOT lease_row."allowedVerbs" @> pg_catalog.jsonb_build_array(NEW.verb)
      OR lease_row.status <> 'ACTIVE'
      OR lease_row."expiresAt" <= now()
      OR control_row."emergencyStop"
      OR control_row."pauseExecution"
      OR mission_row.repository = ANY(control_row."quarantinedRepositories")
      OR lease_row.actor = ANY(control_row."disabledActors") THEN
      RAISE EXCEPTION 'Engineering effect lacks current A2 authority';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW."missionId" <> OLD."missionId"
    OR NEW."capabilityLeaseId" <> OLD."capabilityLeaseId"
    OR NEW."idempotencyKey" <> OLD."idempotencyKey"
    OR NEW."requestHash" <> OLD."requestHash"
    OR NEW."missionHash" <> OLD."missionHash"
    OR NEW."targetRepository" <> OLD."targetRepository"
    OR NEW.verb <> OLD.verb
    OR NEW."targetBaseBranch" <> OLD."targetBaseBranch"
    OR NEW."targetHeadBranch" <> OLD."targetHeadBranch"
    OR NEW."targetCommitSha" <> OLD."targetCommitSha"
    OR NEW."policyHash" <> OLD."policyHash"
    OR NEW."fencingToken" <> OLD."fencingToken"
    OR NEW."createdAt" <> OLD."createdAt" THEN
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
  IF NEW.status = 'UNKNOWN_OUTCOME' THEN NEW."reconciledAt" := NULL; END IF;
  IF NEW.status = 'FAILED' THEN NEW."failedAt" := COALESCE(NEW."failedAt", now()); END IF;
  NEW."updatedAt" := now();
  RETURN NEW;
END;
$$;

-- A normal execution lease still requires a live mission deadline. The sole
-- exception is a read-only reconciliation lease for an already-UNKNOWN remote
-- effect: determining whether an external effect happened remains mandatory
-- after the execution budget, deadline, or GoalSpec authority has ended.
CREATE OR REPLACE FUNCTION public.company_os_engineering_issue_fenced_lease()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  mission_row public."CompanyOsEngineeringMission"%ROWTYPE;
  control_row public."CompanyOsEngineeringControl"%ROWTYPE;
  next_token bigint;
  is_safety_reconciliation boolean;
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
  is_safety_reconciliation := mission_row.status = 'READY_FOR_EFFECT'
    AND NEW."allowedVerbs" = '["READ_REPOSITORY"]'::jsonb
    AND EXISTS (
      SELECT 1
      FROM public."CompanyOsEngineeringEffect"
      WHERE "missionId" = mission_row.id AND status = 'UNKNOWN_OUTCOME'
    );
  IF mission_row.repository = ANY(control_row."quarantinedRepositories")
    OR NEW.actor = ANY(control_row."disabledActors") THEN
    RAISE EXCEPTION 'Engineering capability denied by runtime control';
  END IF;
  IF mission_row.status NOT IN ('READY','READY_FOR_EFFECT')
    OR (mission_row.deadline <= now() AND NOT is_safety_reconciliation)
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

CREATE TABLE public."CompanyOsEngineeringGoalSignal" (
  id text PRIMARY KEY,
  "goalId" text NOT NULL REFERENCES public."CompanyOsEngineeringGoal"(id) ON DELETE RESTRICT,
  "workerId" text NOT NULL CHECK (length("workerId") BETWEEN 1 AND 128),
  "instanceId" text NOT NULL CHECK (length("instanceId") BETWEEN 1 AND 128),
  "baseCommit" text NOT NULL CHECK ("baseCommit" ~ '^[0-9a-f]{40}$'),
  "observedSatisfied" boolean NOT NULL,
  "observedState" jsonb NOT NULL CHECK (jsonb_typeof("observedState") = 'object'),
  "evidenceHash" text NOT NULL CHECK ("evidenceHash" ~ '^[0-9a-f]{64}$'),
  "idempotencyKey" text NOT NULL UNIQUE CHECK (length("idempotencyKey") BETWEEN 8 AND 240),
  "missionId" text REFERENCES public."CompanyOsEngineeringMission"(id) ON DELETE RESTRICT,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "CompanyOsEngineeringGoalSignal_goalId_createdAt_idx"
  ON public."CompanyOsEngineeringGoalSignal" ("goalId", "createdAt" DESC);
CREATE INDEX "CompanyOsEngineeringGoalSignal_missionId_idx"
  ON public."CompanyOsEngineeringGoalSignal" ("missionId");

CREATE OR REPLACE FUNCTION public.company_os_engineering_goal_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW."goalKey" <> OLD."goalKey" OR NEW.version <> OLD.version
    OR NEW."sourceKind" <> OLD."sourceKind" OR NEW."sourceRef" <> OLD."sourceRef"
    OR NEW."sourceHash" <> OLD."sourceHash" OR NEW.objective <> OLD.objective
    OR NEW.repository <> OLD.repository OR NEW."baseBranch" <> OLD."baseBranch"
    OR NEW."desiredState" <> OLD."desiredState" OR NEW."allowedPaths" <> OLD."allowedPaths"
    OR NEW."acceptanceCriteria" <> OLD."acceptanceCriteria"
    OR NEW."autonomyLevel" <> OLD."autonomyLevel" OR NEW."budgetUsd" <> OLD."budgetUsd"
    OR NEW."missionTtlMinutes" <> OLD."missionTtlMinutes" OR NEW."policyHash" <> OLD."policyHash"
    OR NEW.priority <> OLD.priority OR NEW."createdBy" <> OLD."createdBy"
    OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'Engineering GoalSpec contract is immutable; create a new version';
  END IF;
  IF OLD.status = 'COMPLETED' OR (OLD.status = 'PAUSED' AND NEW.status = 'COMPLETED')
    OR (OLD.status = 'ACTIVE' AND NEW.status NOT IN ('ACTIVE','PAUSED','COMPLETED'))
    OR (OLD.status = 'PAUSED' AND NEW.status NOT IN ('PAUSED','ACTIVE')) THEN
    RAISE EXCEPTION 'Invalid Engineering GoalSpec status transition: % -> %', OLD.status, NEW.status;
  END IF;
  NEW."updatedAt" := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER company_os_engineering_goal_guard
BEFORE UPDATE ON public."CompanyOsEngineeringGoal"
FOR EACH ROW EXECUTE FUNCTION public.company_os_engineering_goal_guard();

CREATE TRIGGER company_os_engineering_goal_signal_append_only
BEFORE UPDATE OR DELETE ON public."CompanyOsEngineeringGoalSignal"
FOR EACH ROW EXECUTE FUNCTION public.company_os_v3_reject_mutation();

ALTER TABLE public."CompanyOsEngineeringGoal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CompanyOsEngineeringGoal" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."CompanyOsEngineeringGoalSignal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CompanyOsEngineeringGoalSignal" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."CompanyOsEngineeringGoal"
  FROM PUBLIC, anon, authenticated, service_role, company_os_reader;
REVOKE ALL ON TABLE public."CompanyOsEngineeringGoalSignal"
  FROM PUBLIC, anon, authenticated, service_role, company_os_reader;

GRANT SELECT ON public."CompanyOsEngineeringGoal" TO company_os_v3;
GRANT SELECT, INSERT ON public."CompanyOsEngineeringGoalSignal" TO company_os_v3;

CREATE POLICY company_os_engineering_goal_select ON public."CompanyOsEngineeringGoal"
  FOR SELECT TO company_os_v3 USING (true);
CREATE POLICY company_os_engineering_goal_signal_select ON public."CompanyOsEngineeringGoalSignal"
  FOR SELECT TO company_os_v3 USING (true);
CREATE POLICY company_os_engineering_goal_signal_insert ON public."CompanyOsEngineeringGoalSignal"
  FOR INSERT TO company_os_v3 WITH CHECK (true);

REVOKE ALL ON FUNCTION public.company_os_engineering_goal_guard()
  FROM PUBLIC, anon, authenticated, service_role, company_os_reader;
REVOKE ALL ON FUNCTION public.company_os_engineering_guard_mission()
  FROM PUBLIC, anon, authenticated, service_role, company_os_reader;
REVOKE ALL ON FUNCTION public.company_os_engineering_guard_event()
  FROM PUBLIC, anon, authenticated, service_role, company_os_reader;
REVOKE ALL ON FUNCTION public.company_os_engineering_guard_effect()
  FROM PUBLIC, anon, authenticated, service_role, company_os_reader;
REVOKE ALL ON FUNCTION public.company_os_engineering_issue_fenced_lease()
  FROM PUBLIC, anon, authenticated, service_role, company_os_reader;

INSERT INTO public."CompanyOsEngineeringGoal" (
  id, "goalKey", version, "sourceKind", "sourceRef", "sourceHash", objective,
  repository, "baseBranch", "desiredState", "allowedPaths", "acceptanceCriteria",
  "autonomyLevel", "budgetUsd", "missionTtlMinutes", "policyHash", priority,
  status, "createdBy"
) VALUES (
  'engineering-goal:continuous-autonomy-proof:v1',
  'company-os-continuous-autonomy-proof',
  1,
  'REPOSITORY_DOCUMENT',
  'company-os/AUTONOMOUS_ENGINEERING_V2.md',
  '530edb02c5b3ffd974e7e33f9511b45110723d898925d004d10ef359acfbdca5',
  'Crear company-os/CONTINUOUS_AUTONOMY_PROOF.md como prueba autocontenida de que el reconciliador detectó una brecha durable de estado deseado sin recibir un prompt humano. La prueba debe separar autoridad determinística, propuesta del LLM, efecto externo reversible y readback.',
  'diegoteacade22/Sistema-Manejo-Eswcargo',
  'main',
  '{"type":"FILE_CONTAINS_ALL","path":"company-os/CONTINUOUS_AUTONOMY_PROOF.md","needles":["goalKey: company-os-continuous-autonomy-proof","decisionAuthority: deterministic-orchestrator","llmAuthority: proposal-only","externalEffects: draft-pr-only","trigger: desired-state-diff","businessCron: none","llmHeartbeatWake: false","leaseRenewal: safety-only","Hostinger: active","AWS: archived","Ollama/Qwen: local"]}'::jsonb,
  '["company-os/CONTINUOUS_AUTONOMY_PROOF.md"]'::jsonb,
  '["Existe company-os/CONTINUOUS_AUTONOMY_PROOF.md.","Contiene exactamente goalKey: company-os-continuous-autonomy-proof.","Contiene decisionAuthority: deterministic-orchestrator y llmAuthority: proposal-only.","Contiene externalEffects: draft-pr-only y trigger: desired-state-diff.","Contiene businessCron: none, llmHeartbeatWake: false y leaseRenewal: safety-only.","Preserva Hostinger: active, AWS: archived y Ollama/Qwen: local.","git diff --check no reporta errores."]'::jsonb,
  'A2',
  2.500000,
  360,
  '75322ca698b04f828187b131b49bf60df25df2cf597555e67cfad553f8942929',
  100,
  'PAUSED',
  'migration:company-os-goal-reconciler-v1'
) ON CONFLICT ("goalKey", version) DO NOTHING;

COMMIT;
