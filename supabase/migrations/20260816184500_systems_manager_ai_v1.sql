-- systems-manager-ai-v1: additive technical observability model for Company OS V3.
-- Advisory-only: this migration does not alter operational business tables.
-- Every technical fact is scoped to one immutable snapshot and to evidence from the same case.
BEGIN;

ALTER TABLE public."CompanyOsCase"
  ADD COLUMN IF NOT EXISTS "agentId" text NOT NULL DEFAULT 'general-manager-ai-v3',
  ADD COLUMN IF NOT EXISTS area text NOT NULL DEFAULT 'GENERAL_MANAGEMENT',
  ADD COLUMN IF NOT EXISTS "caseType" text NOT NULL DEFAULT 'ADVISORY',
  ADD COLUMN IF NOT EXISTS "scheduleRunKey" text;

DO $$ BEGIN
  ALTER TABLE public."CompanyOsCase"
    ADD CONSTRAINT "CompanyOsCase_agentId_format_check"
    CHECK ("agentId" ~ '^[a-z0-9][a-z0-9-]{2,79}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public."CompanyOsCase"
    ADD CONSTRAINT "CompanyOsCase_area_format_check"
    CHECK (area ~ '^[A-Z][A-Z0-9_]{1,63}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public."CompanyOsCase"
    ADD CONSTRAINT "CompanyOsCase_caseType_format_check"
    CHECK ("caseType" ~ '^[A-Z][A-Z0-9_]{1,63}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public."CompanyOsCase"
    ADD CONSTRAINT "CompanyOsCase_scheduleRunKey_key" UNIQUE ("scheduleRunKey");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "CompanyOsCase_agentId_status_createdAt_idx"
  ON public."CompanyOsCase" ("agentId", status, "createdAt");
CREATE INDEX IF NOT EXISTS "CompanyOsCase_agentId_caseType_createdAt_idx"
  ON public."CompanyOsCase" ("agentId", "caseType", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "CompanyOsCase_id_agentId_key"
  ON public."CompanyOsCase" (id, "agentId");

-- Required for composite foreign keys that prove evidence belongs to the same case.
CREATE UNIQUE INDEX IF NOT EXISTS "CompanyOsEvidenceRef_id_caseId_key"
  ON public."CompanyOsEvidenceRef" (id, "caseId");

CREATE TABLE public."CompanyOsSystemSnapshot" (
  id text PRIMARY KEY,
  "caseId" text NOT NULL,
  "agentId" text NOT NULL DEFAULT 'systems-manager-ai-v1'
    CHECK ("agentId" = 'systems-manager-ai-v1'),
  "snapshotKey" text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('BASELINE','ON_DEMAND','DAILY','WEEKLY','INCIDENT')),
  status text NOT NULL CHECK (status IN ('COMPLETE','PARTIAL','FAILED')),
  "schemaVersion" integer NOT NULL DEFAULT 1 CHECK ("schemaVersion" > 0),
  "inventoryHash" text NOT NULL CHECK ("inventoryHash" ~ '^[a-f0-9]{64}$'),
  "evidenceId" text NOT NULL,
  "observedAt" timestamptz NOT NULL,
  "completedAt" timestamptz NOT NULL,
  "assetCount" integer NOT NULL DEFAULT 0 CHECK ("assetCount" >= 0),
  "dependencyCount" integer NOT NULL DEFAULT 0 CHECK ("dependencyCount" >= 0),
  "healthCheckCount" integer NOT NULL DEFAULT 0 CHECK ("healthCheckCount" >= 0),
  "riskCount" integer NOT NULL DEFAULT 0 CHECK ("riskCount" >= 0),
  "qualityScore" numeric(5,2) NOT NULL CHECK ("qualityScore" BETWEEN 0 AND 100),
  "coverageScore" numeric(5,2) NOT NULL CHECK ("coverageScore" BETWEEN 0 AND 100),
  "idempotencyKey" text NOT NULL UNIQUE,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CHECK ("completedAt" >= "observedAt"),
  CONSTRAINT "CompanyOsSystemSnapshot_case_fkey"
    FOREIGN KEY ("caseId", "agentId")
    REFERENCES public."CompanyOsCase"(id, "agentId") ON DELETE RESTRICT,
  CONSTRAINT "CompanyOsSystemSnapshot_evidence_case_fkey"
    FOREIGN KEY ("evidenceId", "caseId")
    REFERENCES public."CompanyOsEvidenceRef"(id, "caseId") ON DELETE RESTRICT,
  UNIQUE ("agentId", "snapshotKey"),
  UNIQUE (id, "caseId")
);

CREATE INDEX "CompanyOsSystemSnapshot_agentId_observedAt_idx"
  ON public."CompanyOsSystemSnapshot" ("agentId", "observedAt" DESC);
CREATE INDEX "CompanyOsSystemSnapshot_caseId_createdAt_idx"
  ON public."CompanyOsSystemSnapshot" ("caseId", "createdAt");
CREATE INDEX "CompanyOsSystemSnapshot_status_observedAt_idx"
  ON public."CompanyOsSystemSnapshot" (status, "observedAt" DESC);

CREATE TABLE public."CompanyOsSystemAsset" (
  id text PRIMARY KEY,
  "snapshotId" text NOT NULL,
  "caseId" text NOT NULL,
  "assetKey" text NOT NULL,
  name text NOT NULL,
  category text NOT NULL CHECK (category IN (
    'APPLICATION','DATABASE','SERVER_WORKER','AUTOMATION','INTEGRATION_API',
    'NOTIFICATION_CHANNEL','AI_PROVIDER','CREDENTIAL_REFERENCE','BACKUP','FUTURE_DEVICE',
    'REPOSITORY','DEPLOYMENT','HOST','NETWORK','DOMAIN','DNS','AUTH','QUEUE','STORAGE',
    'OBSERVABILITY','OTHER'
  )),
  provider text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('PRODUCTION','PREVIEW','STAGING','DEVELOPMENT','LOCAL','UNKNOWN')),
  "lifecycleStatus" text NOT NULL CHECK ("lifecycleStatus" IN ('ACTIVE','ARCHIVED','DEPRECATED','PLANNED','FUTURE','UNKNOWN')),
  "healthStatus" text NOT NULL CHECK ("healthStatus" IN ('HEALTHY','DEGRADED','OFFLINE_CONFIRMED','UNKNOWN','UNOBSERVED','NOT_APPLICABLE')),
  criticality text NOT NULL CHECK (criticality IN ('CRITICAL','HIGH','MEDIUM','LOW','UNKNOWN')),
  "ownerRef" text,
  region text,
  version text,
  "safeLocator" text,
  "safeAttributes" jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof("safeAttributes") = 'object'),
  "evidenceId" text NOT NULL,
  "observedAt" timestamptz NOT NULL,
  "idempotencyKey" text NOT NULL UNIQUE,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "CompanyOsSystemAsset_snapshot_case_fkey"
    FOREIGN KEY ("snapshotId", "caseId")
    REFERENCES public."CompanyOsSystemSnapshot"(id, "caseId") ON DELETE RESTRICT,
  CONSTRAINT "CompanyOsSystemAsset_evidence_case_fkey"
    FOREIGN KEY ("evidenceId", "caseId")
    REFERENCES public."CompanyOsEvidenceRef"(id, "caseId") ON DELETE RESTRICT,
  UNIQUE ("snapshotId", "assetKey"),
  UNIQUE (id, "snapshotId", "caseId")
);

CREATE INDEX "CompanyOsSystemAsset_snapshot_type_status_idx"
  ON public."CompanyOsSystemAsset" ("snapshotId", category, "lifecycleStatus", "healthStatus");
CREATE INDEX "CompanyOsSystemAsset_provider_environment_idx"
  ON public."CompanyOsSystemAsset" (provider, environment);
CREATE INDEX "CompanyOsSystemAsset_criticality_status_idx"
  ON public."CompanyOsSystemAsset" (criticality, "healthStatus");
CREATE UNIQUE INDEX "CompanyOsSystemAsset_id_caseId_key"
  ON public."CompanyOsSystemAsset" (id, "caseId");

-- Extend the common delivery ledger without invalidating General Manager history.
ALTER TABLE public."CompanyOsNotificationDelivery"
  ADD COLUMN IF NOT EXISTS "agentId" text NOT NULL DEFAULT 'general-manager-ai-v3',
  ADD COLUMN IF NOT EXISTS "evidenceFingerprint" text,
  ADD COLUMN IF NOT EXISTS "assetId" text;

DO $$ BEGIN
  ALTER TABLE public."CompanyOsNotificationDelivery"
    ADD CONSTRAINT "CompanyOsNotificationDelivery_agentId_format_check"
    CHECK ("agentId" ~ '^[a-z0-9][a-z0-9-]{2,79}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public."CompanyOsNotificationDelivery"
    ADD CONSTRAINT "CompanyOsNotificationDelivery_evidenceFingerprint_check"
    CHECK ("evidenceFingerprint" IS NULL OR "evidenceFingerprint" ~ '^[a-f0-9]{64}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public."CompanyOsNotificationDelivery"
    ADD CONSTRAINT "CompanyOsNotificationDelivery_asset_case_fkey"
    FOREIGN KEY ("assetId", "caseId")
    REFERENCES public."CompanyOsSystemAsset"(id, "caseId") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "CompanyOsNotificationDelivery_contract_dedupe_key"
  ON public."CompanyOsNotificationDelivery"
  ("agentId", channel, "eventType", "evidenceFingerprint", (COALESCE("assetId", '')))
  WHERE "evidenceFingerprint" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "CompanyOsNotificationDelivery_agent_asset_createdAt_idx"
  ON public."CompanyOsNotificationDelivery" ("agentId", "assetId", "createdAt" DESC);

CREATE TABLE public."CompanyOsSystemDependency" (
  id text PRIMARY KEY,
  "snapshotId" text NOT NULL,
  "caseId" text NOT NULL,
  "dependencyKey" text NOT NULL,
  "fromAssetKey" text NOT NULL,
  "toAssetKey" text NOT NULL,
  "dependencyType" text NOT NULL CHECK ("dependencyType" IN (
    'DATABASE','SIGNED_WEBHOOK','MODEL_API','NOTIFICATION_API','NOTIFICATION_CHANNEL',
    'DEPLOYMENT_SOURCE','RUNTIME','DATA','AUTH','NETWORK','DEPLOYMENT','OBSERVABILITY',
    'MANUAL','OTHER'
  )),
  criticality text NOT NULL CHECK (criticality IN ('CRITICAL','HIGH','MEDIUM','LOW','UNKNOWN')),
  status text NOT NULL CHECK (status IN ('CONFIRMED','INFERRED','DEGRADED','BROKEN','UNKNOWN')),
  direction text NOT NULL DEFAULT 'OUTBOUND' CHECK (direction IN ('OUTBOUND','INBOUND','BIDIRECTIONAL')),
  "evidenceId" text NOT NULL,
  "observedAt" timestamptz NOT NULL,
  "idempotencyKey" text NOT NULL UNIQUE,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "CompanyOsSystemDependency_snapshot_case_fkey"
    FOREIGN KEY ("snapshotId", "caseId")
    REFERENCES public."CompanyOsSystemSnapshot"(id, "caseId") ON DELETE RESTRICT,
  CONSTRAINT "CompanyOsSystemDependency_from_asset_fkey"
    FOREIGN KEY ("snapshotId", "fromAssetKey")
    REFERENCES public."CompanyOsSystemAsset"("snapshotId", "assetKey") ON DELETE RESTRICT,
  CONSTRAINT "CompanyOsSystemDependency_to_asset_fkey"
    FOREIGN KEY ("snapshotId", "toAssetKey")
    REFERENCES public."CompanyOsSystemAsset"("snapshotId", "assetKey") ON DELETE RESTRICT,
  CONSTRAINT "CompanyOsSystemDependency_evidence_case_fkey"
    FOREIGN KEY ("evidenceId", "caseId")
    REFERENCES public."CompanyOsEvidenceRef"(id, "caseId") ON DELETE RESTRICT,
  CHECK ("fromAssetKey" <> "toAssetKey"),
  UNIQUE ("snapshotId", "dependencyKey")
);

CREATE INDEX "CompanyOsSystemDependency_snapshot_status_idx"
  ON public."CompanyOsSystemDependency" ("snapshotId", status, criticality);
CREATE INDEX "CompanyOsSystemDependency_from_asset_idx"
  ON public."CompanyOsSystemDependency" ("snapshotId", "fromAssetKey");
CREATE INDEX "CompanyOsSystemDependency_to_asset_idx"
  ON public."CompanyOsSystemDependency" ("snapshotId", "toAssetKey");

CREATE TABLE public."CompanyOsSystemHealthObservation" (
  id text PRIMARY KEY,
  "snapshotId" text NOT NULL,
  "caseId" text NOT NULL,
  "assetKey" text NOT NULL,
  "checkKey" text NOT NULL,
  status text NOT NULL CHECK (status IN ('PASS','WARN','FAIL','UNKNOWN','UNOBSERVED','STALE')),
  "signalType" text NOT NULL CHECK ("signalType" IN ('AVAILABILITY','LATENCY','ERROR_RATE','FRESHNESS','CAPACITY','SECURITY','CONFIGURATION','MANUAL','OTHER')),
  summary text NOT NULL,
  "numericValue" numeric,
  unit text,
  "freshnessSeconds" integer CHECK ("freshnessSeconds" IS NULL OR "freshnessSeconds" >= 0),
  "qualityScore" numeric(5,2) NOT NULL CHECK ("qualityScore" BETWEEN 0 AND 100),
  "evidenceId" text NOT NULL,
  "observedAt" timestamptz NOT NULL,
  "idempotencyKey" text NOT NULL UNIQUE,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "CompanyOsSystemHealth_snapshot_case_fkey"
    FOREIGN KEY ("snapshotId", "caseId")
    REFERENCES public."CompanyOsSystemSnapshot"(id, "caseId") ON DELETE RESTRICT,
  CONSTRAINT "CompanyOsSystemHealth_asset_fkey"
    FOREIGN KEY ("snapshotId", "assetKey")
    REFERENCES public."CompanyOsSystemAsset"("snapshotId", "assetKey") ON DELETE RESTRICT,
  CONSTRAINT "CompanyOsSystemHealth_evidence_case_fkey"
    FOREIGN KEY ("evidenceId", "caseId")
    REFERENCES public."CompanyOsEvidenceRef"(id, "caseId") ON DELETE RESTRICT,
  UNIQUE ("snapshotId", "assetKey", "checkKey")
);

CREATE INDEX "CompanyOsSystemHealth_snapshot_status_idx"
  ON public."CompanyOsSystemHealthObservation" ("snapshotId", status, "observedAt" DESC);
CREATE INDEX "CompanyOsSystemHealth_asset_observedAt_idx"
  ON public."CompanyOsSystemHealthObservation" ("assetKey", "observedAt" DESC);

CREATE TABLE public."CompanyOsSystemCoverageObservation" (
  id text PRIMARY KEY,
  "snapshotId" text NOT NULL,
  "caseId" text NOT NULL,
  "sourceKey" text NOT NULL,
  "sourceType" text NOT NULL CHECK ("sourceType" IN ('DATABASE','HOSTING','REPOSITORY','WORKER','NETWORK','AUTH','NOTIFICATION','LOCAL','OTHER')),
  status text NOT NULL CHECK (status IN ('OBSERVED','PARTIAL','UNOBSERVED','STALE','ERROR','NOT_APPLICABLE')),
  "expectedSignals" integer NOT NULL CHECK ("expectedSignals" >= 0),
  "observedSignals" integer NOT NULL CHECK ("observedSignals" >= 0 AND "observedSignals" <= "expectedSignals"),
  "qualityScore" numeric(5,2) NOT NULL CHECK ("qualityScore" BETWEEN 0 AND 100),
  "freshnessSeconds" integer CHECK ("freshnessSeconds" IS NULL OR "freshnessSeconds" >= 0),
  "gapReason" text,
  "evidenceId" text NOT NULL,
  "observedAt" timestamptz NOT NULL,
  "idempotencyKey" text NOT NULL UNIQUE,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "CompanyOsSystemCoverage_snapshot_case_fkey"
    FOREIGN KEY ("snapshotId", "caseId")
    REFERENCES public."CompanyOsSystemSnapshot"(id, "caseId") ON DELETE RESTRICT,
  CONSTRAINT "CompanyOsSystemCoverage_evidence_case_fkey"
    FOREIGN KEY ("evidenceId", "caseId")
    REFERENCES public."CompanyOsEvidenceRef"(id, "caseId") ON DELETE RESTRICT,
  UNIQUE ("snapshotId", "sourceKey")
);

CREATE INDEX "CompanyOsSystemCoverage_snapshot_status_idx"
  ON public."CompanyOsSystemCoverageObservation" ("snapshotId", status, "qualityScore");
CREATE INDEX "CompanyOsSystemCoverage_source_observedAt_idx"
  ON public."CompanyOsSystemCoverageObservation" ("sourceKey", "observedAt" DESC);

CREATE TABLE public."CompanyOsSystemRisk" (
  id text PRIMARY KEY,
  "snapshotId" text NOT NULL,
  "caseId" text NOT NULL,
  "riskKey" text NOT NULL,
  "assetKey" text,
  classification text NOT NULL CHECK (classification IN ('ACTION_REQUIRED','OPPORTUNITY','REVIEW','INFORMATIONAL','IGNORE')),
  severity text NOT NULL CHECK (severity IN ('CRITICAL','HIGH','MEDIUM','LOW','INFO')),
  likelihood text NOT NULL CHECK (likelihood IN ('CERTAIN','LIKELY','POSSIBLE','UNLIKELY','UNKNOWN')),
  status text NOT NULL CHECK (status IN ('OPEN','ACKNOWLEDGED','POSTPONED','RESOLVED','MARKED_INCORRECT')),
  title text NOT NULL,
  finding text NOT NULL,
  impact text NOT NULL,
  "nextStep" text NOT NULL,
  score numeric(6,2) NOT NULL CHECK (score BETWEEN 0 AND 100),
  priority text NOT NULL CHECK (priority IN ('P0','P1','P2','P3','P4')),
  confidence numeric(5,4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  cause text NOT NULL,
  hypothesis text NOT NULL,
  "affectedDependencies" text[] NOT NULL DEFAULT '{}'::text[],
  "recommendedAction" text NOT NULL,
  effort text NOT NULL CHECK (effort IN ('XS','S','M','L','XL','UNKNOWN')),
  "changeRisk" text NOT NULL CHECK ("changeRisk" IN ('CRITICAL','HIGH','MEDIUM','LOW','NONE','UNKNOWN')),
  rollback text NOT NULL,
  owner text NOT NULL,
  "targetDate" date,
  "missingEvidence" text[] NOT NULL DEFAULT '{}'::text[],
  "reasonCodes" text[] NOT NULL DEFAULT '{}'::text[],
  "evidenceFingerprint" text NOT NULL CHECK ("evidenceFingerprint" ~ '^[a-f0-9]{64}$'),
  "ruleVersion" text NOT NULL CHECK ("ruleVersion" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  confirmed boolean NOT NULL DEFAULT false,
  "coverageGap" boolean NOT NULL DEFAULT false,
  "qualityScore" numeric(5,2) NOT NULL CHECK ("qualityScore" BETWEEN 0 AND 100),
  "evidenceId" text NOT NULL,
  "observedAt" timestamptz NOT NULL,
  "idempotencyKey" text NOT NULL UNIQUE,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "CompanyOsSystemRisk_snapshot_case_fkey"
    FOREIGN KEY ("snapshotId", "caseId")
    REFERENCES public."CompanyOsSystemSnapshot"(id, "caseId") ON DELETE RESTRICT,
  CONSTRAINT "CompanyOsSystemRisk_asset_fkey"
    FOREIGN KEY ("snapshotId", "assetKey")
    REFERENCES public."CompanyOsSystemAsset"("snapshotId", "assetKey") ON DELETE RESTRICT,
  CONSTRAINT "CompanyOsSystemRisk_evidence_case_fkey"
    FOREIGN KEY ("evidenceId", "caseId")
    REFERENCES public."CompanyOsEvidenceRef"(id, "caseId") ON DELETE RESTRICT,
  CHECK (NOT confirmed OR classification <> 'IGNORE'),
  CHECK (array_position("affectedDependencies", NULL) IS NULL AND cardinality("affectedDependencies") <= 100),
  CHECK (array_position("missingEvidence", NULL) IS NULL AND cardinality("missingEvidence") <= 100),
  CHECK (array_position("reasonCodes", NULL) IS NULL AND cardinality("reasonCodes") <= 50),
  CHECK (array_to_string("reasonCodes", ',') ~ '^[A-Z0-9_,-]*$'),
  UNIQUE ("snapshotId", "riskKey"),
  UNIQUE (id, "snapshotId", "caseId")
);

CREATE INDEX "CompanyOsSystemRisk_snapshot_classification_idx"
  ON public."CompanyOsSystemRisk" ("snapshotId", classification, severity);
CREATE INDEX "CompanyOsSystemRisk_status_severity_observedAt_idx"
  ON public."CompanyOsSystemRisk" (status, severity, "observedAt" DESC);
CREATE INDEX "CompanyOsSystemRisk_asset_status_idx"
  ON public."CompanyOsSystemRisk" ("assetKey", status) WHERE "assetKey" IS NOT NULL;
CREATE INDEX "CompanyOsSystemRisk_priority_score_idx"
  ON public."CompanyOsSystemRisk" (priority, score DESC, confidence DESC);
CREATE INDEX "CompanyOsSystemRisk_evidenceFingerprint_idx"
  ON public."CompanyOsSystemRisk" ("evidenceFingerprint");

CREATE TABLE public."CompanyOsSystemRiskHistory" (
  id text PRIMARY KEY,
  "riskId" text NOT NULL,
  "snapshotId" text NOT NULL,
  "caseId" text NOT NULL,
  "eventType" text NOT NULL CHECK ("eventType" IN ('DETECTED','CLASSIFIED','ACKNOWLEDGED','POSTPONED','RESOLVED','MARKED_INCORRECT','REOPENED','COMMENTED')),
  "fromStatus" text,
  "toStatus" text NOT NULL CHECK ("toStatus" IN ('OPEN','ACKNOWLEDGED','POSTPONED','RESOLVED','MARKED_INCORRECT')),
  "actorRef" text NOT NULL,
  rationale text NOT NULL,
  "evidenceId" text NOT NULL,
  "idempotencyKey" text NOT NULL UNIQUE,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "CompanyOsSystemRiskHistory_risk_fkey"
    FOREIGN KEY ("riskId", "snapshotId", "caseId")
    REFERENCES public."CompanyOsSystemRisk"(id, "snapshotId", "caseId") ON DELETE RESTRICT,
  CONSTRAINT "CompanyOsSystemRiskHistory_evidence_case_fkey"
    FOREIGN KEY ("evidenceId", "caseId")
    REFERENCES public."CompanyOsEvidenceRef"(id, "caseId") ON DELETE RESTRICT,
  CHECK ("fromStatus" IS NULL OR "fromStatus" IN ('OPEN','ACKNOWLEDGED','POSTPONED','RESOLVED','MARKED_INCORRECT'))
);

CREATE INDEX "CompanyOsSystemRiskHistory_risk_createdAt_idx"
  ON public."CompanyOsSystemRiskHistory" ("riskId", "createdAt");
CREATE INDEX "CompanyOsSystemRiskHistory_case_createdAt_idx"
  ON public."CompanyOsSystemRiskHistory" ("caseId", "createdAt");

-- Generic schedules: configuration changes append a revision; only runtime cursors are mutable.
CREATE TABLE public."CompanyOsAgentSchedule" (
  id text PRIMARY KEY,
  "agentId" text NOT NULL CHECK ("agentId" ~ '^[a-z0-9][a-z0-9-]{2,79}$'),
  "scheduleKey" text NOT NULL CHECK ("scheduleKey" ~ '^[a-z0-9][a-z0-9-]{2,79}$'),
  revision integer NOT NULL CHECK (revision > 0),
  cadence text NOT NULL CHECK (cadence IN ('DAILY','WEEKLY')),
  "localTime" time without time zone NOT NULL,
  "timeZone" text NOT NULL CHECK ("timeZone" = 'UTC' OR "timeZone" ~ '^[A-Za-z_]+(/[A-Za-z0-9_+.-]+)+$'),
  "dayOfWeek" smallint,
  enabled boolean NOT NULL DEFAULT true,
  "caseType" text NOT NULL CHECK ("caseType" ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  scope text NOT NULL CHECK (scope IN ('BASELINE','DEEP_REVIEW')),
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(configuration) = 'object'),
  "effectiveFrom" timestamptz NOT NULL DEFAULT now(),
  "supersedesScheduleId" text,
  "nextRunAt" timestamptz,
  "lastRunAt" timestamptz,
  "idempotencyKey" text NOT NULL UNIQUE,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (cadence = 'DAILY' AND "dayOfWeek" IS NULL)
    OR (cadence = 'WEEKLY' AND "dayOfWeek" BETWEEN 0 AND 6)
  ),
  CHECK (NOT enabled OR "nextRunAt" IS NOT NULL),
  CHECK ("lastRunAt" IS NULL OR "nextRunAt" IS NULL OR "nextRunAt" > "lastRunAt"),
  UNIQUE ("agentId", "scheduleKey", revision),
  UNIQUE (id, "agentId", "scheduleKey"),
  CONSTRAINT "CompanyOsAgentSchedule_supersedes_fkey"
    FOREIGN KEY ("supersedesScheduleId", "agentId", "scheduleKey")
    REFERENCES public."CompanyOsAgentSchedule"(id, "agentId", "scheduleKey") ON DELETE RESTRICT
);

CREATE INDEX "CompanyOsAgentSchedule_agent_enabled_effective_idx"
  ON public."CompanyOsAgentSchedule" ("agentId", enabled, "effectiveFrom" DESC);
CREATE INDEX "CompanyOsAgentSchedule_due_lookup_idx"
  ON public."CompanyOsAgentSchedule" ("nextRunAt", "agentId") WHERE enabled;

INSERT INTO public."CompanyOsAgentSchedule" (
  id, "agentId", "scheduleKey", revision, cadence, "localTime", "timeZone", "dayOfWeek",
  enabled, "caseType", scope, configuration, "nextRunAt", "lastRunAt", "idempotencyKey"
) VALUES
  (
    'schedule_systems_manager_daily_v1', 'systems-manager-ai-v1', 'daily-baseline', 1,
    'DAILY', time '08:00:00', 'America/New_York', NULL, true,
    'SYSTEMS_BASELINE', 'BASELINE', '{"maxOutputTokens":3000,"targetTotalTokens":12000}'::jsonb,
    CASE
      WHEN (((now() AT TIME ZONE 'America/New_York')::date + time '08:00:00') AT TIME ZONE 'America/New_York') > now()
        THEN (((now() AT TIME ZONE 'America/New_York')::date + time '08:00:00') AT TIME ZONE 'America/New_York')
      ELSE ((((now() AT TIME ZONE 'America/New_York')::date + 1) + time '08:00:00') AT TIME ZONE 'America/New_York')
    END,
    NULL,
    'systems-manager-ai-v1:daily-baseline:v1'
  ),
  (
    'schedule_systems_manager_weekly_v1', 'systems-manager-ai-v1', 'weekly-deep-review', 1,
    'WEEKLY', time '08:00:00', 'America/New_York', 1, false,
    'SYSTEMS_DEEP_REVIEW', 'DEEP_REVIEW', '{"runOnlyWhenUseful":true,"configurable":true}'::jsonb,
    NULL, NULL,
    'systems-manager-ai-v1:weekly-deep-review:v1'
  )
ON CONFLICT ("idempotencyKey") DO NOTHING;

-- Serialize inserts per snapshot so concurrent workers cannot exceed five actionable risks.
CREATE OR REPLACE FUNCTION public.company_os_systems_limit_action_risks() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.classification = 'ACTION_REQUIRED' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW."snapshotId", 0));
    IF (SELECT count(*) FROM public."CompanyOsSystemRisk" r
        WHERE r."snapshotId" = NEW."snapshotId" AND r.classification = 'ACTION_REQUIRED') >= 5 THEN
      RAISE EXCEPTION 'systems-manager-ai-v1 permits at most five ACTION_REQUIRED risks per snapshot';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER company_os_systems_limit_action_risks
BEFORE INSERT ON public."CompanyOsSystemRisk"
FOR EACH ROW EXECUTE FUNCTION public.company_os_systems_limit_action_risks();

-- Technical history is immutable. Corrections and lifecycle changes are new history rows.
DO $$ DECLARE relation_name text; BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'CompanyOsSystemSnapshot',
    'CompanyOsSystemAsset',
    'CompanyOsSystemDependency',
    'CompanyOsSystemHealthObservation',
    'CompanyOsSystemCoverageObservation',
    'CompanyOsSystemRisk',
    'CompanyOsSystemRiskHistory'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER company_os_systems_append_only BEFORE UPDATE OR DELETE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.company_os_v3_reject_mutation()',
      relation_name
    );
  END LOOP;
END $$;

-- Minimum privilege: no public/client/reader access; the dedicated server role can only read and append.
DO $$ DECLARE relation_name text; BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'CompanyOsSystemSnapshot',
    'CompanyOsSystemAsset',
    'CompanyOsSystemDependency',
    'CompanyOsSystemHealthObservation',
    'CompanyOsSystemCoverageObservation',
    'CompanyOsSystemRisk',
    'CompanyOsSystemRiskHistory',
    'CompanyOsAgentSchedule'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', relation_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', relation_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated, company_os_reader', relation_name);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE public.%I TO company_os_v3', relation_name);
    EXECUTE format('CREATE POLICY company_os_systems_select ON public.%I FOR SELECT TO company_os_v3 USING (true)', relation_name);
    EXECUTE format('CREATE POLICY company_os_systems_insert ON public.%I FOR INSERT TO company_os_v3 WITH CHECK (true)', relation_name);
  END LOOP;
END $$;

-- Applied after REVOKE ALL so the worker retains only the three mutable cursor columns.
GRANT UPDATE ("nextRunAt", "lastRunAt", "updatedAt")
  ON public."CompanyOsAgentSchedule" TO company_os_v3;
CREATE POLICY company_os_systems_update_schedule
  ON public."CompanyOsAgentSchedule" FOR UPDATE TO company_os_v3
  USING (true) WITH CHECK (true);

REVOKE ALL ON FUNCTION public.company_os_systems_limit_action_risks() FROM PUBLIC;

COMMENT ON COLUMN public."CompanyOsCase"."agentId" IS 'Stable Company OS agent identity; existing V3 cases retain general-manager-ai-v3.';
COMMENT ON COLUMN public."CompanyOsCase".area IS 'Normalized routing area, not an authorization boundary.';
COMMENT ON COLUMN public."CompanyOsCase"."caseType" IS 'Normalized workflow type, not an authorization boundary.';
COMMENT ON COLUMN public."CompanyOsCase"."scheduleRunKey" IS 'Nullable unique key that deduplicates generic scheduled executions; intentionally has no default.';
COMMENT ON TABLE public."CompanyOsSystemSnapshot" IS 'Immutable systems-manager-ai-v1 inventory snapshot with evidence closed to the same Company OS case.';
COMMENT ON TABLE public."CompanyOsSystemAsset" IS 'Immutable normalized technical inventory for one snapshot; safeAttributes must never contain credentials.';
COMMENT ON TABLE public."CompanyOsSystemDependency" IS 'Immutable dependency graph whose endpoints belong to the same snapshot.';
COMMENT ON TABLE public."CompanyOsSystemHealthObservation" IS 'Immutable asset health evidence at snapshot time.';
COMMENT ON TABLE public."CompanyOsSystemCoverageObservation" IS 'Immutable observability and source-quality coverage, including explicit unobserved gaps.';
COMMENT ON TABLE public."CompanyOsSystemRisk" IS 'Immutable classified risk facts; lifecycle changes are recorded in CompanyOsSystemRiskHistory.';
COMMENT ON TABLE public."CompanyOsSystemRiskHistory" IS 'Append-only risk lifecycle and correction history with same-case evidence.';
COMMENT ON TABLE public."CompanyOsAgentSchedule" IS 'Generic versioned agent schedules; daily systems baseline is fixed at 08:00 America/New_York, weekly is configurable, and only runtime cursor columns are mutable.';

COMMIT;

-- Documented rollback (review dependencies, then execute manually in a maintenance transaction):
-- BEGIN;
-- DROP INDEX IF EXISTS public."CompanyOsNotificationDelivery_agent_asset_createdAt_idx";
-- DROP INDEX IF EXISTS public."CompanyOsNotificationDelivery_contract_dedupe_key";
-- ALTER TABLE public."CompanyOsNotificationDelivery" DROP CONSTRAINT IF EXISTS "CompanyOsNotificationDelivery_asset_case_fkey";
-- ALTER TABLE public."CompanyOsNotificationDelivery" DROP CONSTRAINT IF EXISTS "CompanyOsNotificationDelivery_evidenceFingerprint_check";
-- ALTER TABLE public."CompanyOsNotificationDelivery" DROP CONSTRAINT IF EXISTS "CompanyOsNotificationDelivery_agentId_format_check";
-- ALTER TABLE public."CompanyOsNotificationDelivery" DROP COLUMN IF EXISTS "assetId";
-- ALTER TABLE public."CompanyOsNotificationDelivery" DROP COLUMN IF EXISTS "evidenceFingerprint";
-- ALTER TABLE public."CompanyOsNotificationDelivery" DROP COLUMN IF EXISTS "agentId";
-- DROP TABLE IF EXISTS public."CompanyOsAgentSchedule";
-- DROP TABLE IF EXISTS public."CompanyOsSystemRiskHistory";
-- DROP TABLE IF EXISTS public."CompanyOsSystemRisk";
-- DROP TABLE IF EXISTS public."CompanyOsSystemCoverageObservation";
-- DROP TABLE IF EXISTS public."CompanyOsSystemHealthObservation";
-- DROP TABLE IF EXISTS public."CompanyOsSystemDependency";
-- DROP TABLE IF EXISTS public."CompanyOsSystemAsset";
-- DROP TABLE IF EXISTS public."CompanyOsSystemSnapshot";
-- DROP FUNCTION IF EXISTS public.company_os_systems_limit_action_risks();
-- DROP INDEX IF EXISTS public."CompanyOsEvidenceRef_id_caseId_key"; -- only if no other FK uses it
-- DROP INDEX IF EXISTS public."CompanyOsCase_id_agentId_key";
-- DROP INDEX IF EXISTS public."CompanyOsCase_agentId_status_createdAt_idx";
-- DROP INDEX IF EXISTS public."CompanyOsCase_agentId_caseType_createdAt_idx";
-- ALTER TABLE public."CompanyOsCase" DROP CONSTRAINT IF EXISTS "CompanyOsCase_agentId_format_check";
-- ALTER TABLE public."CompanyOsCase" DROP CONSTRAINT IF EXISTS "CompanyOsCase_area_format_check";
-- ALTER TABLE public."CompanyOsCase" DROP CONSTRAINT IF EXISTS "CompanyOsCase_caseType_format_check";
-- ALTER TABLE public."CompanyOsCase" DROP CONSTRAINT IF EXISTS "CompanyOsCase_scheduleRunKey_key";
-- ALTER TABLE public."CompanyOsCase" DROP COLUMN IF EXISTS "scheduleRunKey";
-- ALTER TABLE public."CompanyOsCase" DROP COLUMN IF EXISTS "agentId";
-- ALTER TABLE public."CompanyOsCase" DROP COLUMN IF EXISTS area;
-- ALTER TABLE public."CompanyOsCase" DROP COLUMN IF EXISTS "caseType";
-- COMMIT;
