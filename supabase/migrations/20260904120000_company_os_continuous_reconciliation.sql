-- Durable reconciliation readback for the existing continuous-objective plane.
-- This is scheduling metadata only; cases still use the shared V3 queue, leases,
-- locks, budgets and worker. No business table or second worker is introduced.
BEGIN;

ALTER TABLE public."CompanyOsContinuousObjective"
  ADD COLUMN IF NOT EXISTS "reconciliationStatus" text NOT NULL DEFAULT 'QUIESCENT',
  ADD COLUMN IF NOT EXISTS "lastGeneratedCount" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "zeroGenerationReason" text NOT NULL DEFAULT 'OBJECTIVE_NOT_DUE',
  ADD COLUMN IF NOT EXISTS "lastReconciliationRunId" text,
  ADD COLUMN IF NOT EXISTS "lastReconciledAt" timestamptz;

ALTER TABLE public."CompanyOsContinuousObjective"
  ADD CONSTRAINT "CompanyOsContinuousObjective_reconciliationStatus_check"
    CHECK ("reconciliationStatus" IN ('QUIESCENT','PENDING','STALE','AWAITING_HUMAN','BLOCKED_FINAL','EXPIRED','INVALID')),
  ADD CONSTRAINT "CompanyOsContinuousObjective_lastGeneratedCount_check"
    CHECK ("lastGeneratedCount" >= 0),
  ADD CONSTRAINT "CompanyOsContinuousObjective_zeroGenerationReason_check"
    CHECK ("zeroGenerationReason" IN ('GENERATED','READY_TO_GENERATE','ACTIVE_UNIT_IN_FLIGHT','NO_ELIGIBLE_SOURCE',
      'STALE_SOURCE','AWAITING_HUMAN','BLOCKED_EXTERNAL','OBJECTIVE_PAUSED','OBJECTIVE_EXPIRED','OBJECTIVE_NOT_DUE','INVALID_OBJECTIVE')),
  ADD CONSTRAINT "CompanyOsContinuousObjective_lastReconciliationRunId_check"
    CHECK ("lastReconciliationRunId" IS NULL OR length("lastReconciliationRunId") BETWEEN 8 AND 160);

ALTER TABLE public."CompanyOsObjectiveUnit"
  ADD COLUMN IF NOT EXISTS "rootKey" text;

UPDATE public."CompanyOsObjectiveUnit"
SET "rootKey" = COALESCE(NULLIF(source->>'threadId', ''), "sourceId")
WHERE "rootKey" IS NULL;

ALTER TABLE public."CompanyOsObjectiveUnit"
  ALTER COLUMN "rootKey" SET NOT NULL,
  ADD CONSTRAINT "CompanyOsObjectiveUnit_rootKey_check"
    CHECK (length("rootKey") BETWEEN 1 AND 180 AND "rootKey" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,179}$');

-- A root may have one active durable unit for one objective/version. Fingerprints
-- remain evidence; settled/skipped revisions stay as history and may be retried
-- only after the previous active unit has reached a terminal state.
CREATE OR REPLACE FUNCTION public.company_os_continuous_objective_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Continuous objective history cannot be deleted'; END IF;
  IF TG_TABLE_NAME = 'CompanyOsContinuousObjective' THEN
    IF (to_jsonb(NEW) - ARRAY['status','controlRevision','nextScanAt','scanCursor','scanObserved','scanExcluded','scanDomains','sourcesObserved','sourcesExcluded','lastScanAt','reconciliationStatus','lastGeneratedCount','zeroGenerationReason','lastReconciliationRunId','lastReconciledAt','updatedAt'])
      IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','controlRevision','nextScanAt','scanCursor','scanObserved','scanExcluded','scanDomains','sourcesObserved','sourcesExcluded','lastScanAt','reconciliationStatus','lastGeneratedCount','zeroGenerationReason','lastReconciliationRunId','lastReconciledAt','updatedAt']) THEN
      RAISE EXCEPTION 'Objective scope is immutable';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND (OLD.status = 'EXPIRED' OR NEW."controlRevision" <> OLD."controlRevision" + 1) THEN
      RAISE EXCEPTION 'Invalid objective control transition';
    END IF;
    IF NEW.status = OLD.status AND NEW."controlRevision" <> OLD."controlRevision" THEN
      RAISE EXCEPTION 'Control revision requires a status transition';
    END IF;
    IF NEW.status = 'ACTIVE' AND NEW."endsAt" <= now() THEN RAISE EXCEPTION 'Objective expired'; END IF;
  ELSE
    IF (to_jsonb(NEW) - ARRAY['status','caseId','resultSummary','resultEvidence','updatedAt'])
      IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','caseId','resultSummary','resultEvidence','updatedAt']) THEN
      RAISE EXCEPTION 'Objective unit source is immutable';
    END IF;
    IF OLD."caseId" IS NOT NULL AND NEW."caseId" IS DISTINCT FROM OLD."caseId" THEN RAISE EXCEPTION 'Case binding is immutable'; END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
      (OLD.status = 'PLANNED' AND NEW.status IN ('QUEUED','SKIPPED')) OR
      (OLD.status = 'QUEUED' AND NEW.status IN ('ANALYZED','VERIFIED','NEEDS_REVIEW','BLOCKED','SKIPPED')) OR
      (OLD.status IN ('BLOCKED','NEEDS_REVIEW') AND NEW.status IN ('ANALYZED','VERIFIED','NEEDS_REVIEW','BLOCKED','SKIPPED')) OR
      (OLD.status IN ('ANALYZED','VERIFIED') AND NEW.status = 'SKIPPED')
    ) THEN RAISE EXCEPTION 'Invalid objective unit transition'; END IF;
  END IF;
  RETURN NEW;
END $$;

-- Keep one active work unit per root while retaining settled/skipped history.
-- Existing fingerprint duplicates are consolidated deterministically first.
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY "goalId",version,"rootKey"
    ORDER BY ("caseId" IS NOT NULL) DESC,"updatedAt" DESC,id
  ) AS duplicate_rank
  FROM public."CompanyOsObjectiveUnit"
)
UPDATE public."CompanyOsObjectiveUnit" unit
SET status='SKIPPED',
    "resultSummary"=COALESCE(unit."resultSummary", 'Unidad histórica consolidada por raíz.'),
    "updatedAt"=clock_timestamp()
FROM ranked
WHERE ranked.id=unit.id AND ranked.duplicate_rank > 1;

CREATE UNIQUE INDEX "CompanyOsObjectiveUnit_goal_version_root_key"
  ON public."CompanyOsObjectiveUnit" ("goalId",version,"rootKey")
  WHERE status IN ('PLANNED','QUEUED','BLOCKED','NEEDS_REVIEW');

COMMIT;
