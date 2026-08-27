-- Company OS Runtime 24/7: additive Mac worker control plane.
-- Advisory-only. This migration changes only internal Company OS relations.
BEGIN;

ALTER TABLE public."CompanyOsCase"
  DROP CONSTRAINT IF EXISTS "CompanyOsCase_status_check";

ALTER TABLE public."CompanyOsCase"
  ADD CONSTRAINT "CompanyOsCase_status_runtime_check" CHECK (status IN (
    'QUEUED','CLAIMED','RUNNING','NEEDS_REVIEW','COMPLETED','BLOCKED',
    'FAILED_RETRYABLE','FAILED_FINAL','CANCELLED',
    'ANALYZING','AWAITING_REVIEW','FAILED'
  )),
  ADD COLUMN IF NOT EXISTS "maxAttempts" integer NOT NULL DEFAULT 3 CHECK ("maxAttempts" BETWEEN 1 AND 10),
  ADD COLUMN IF NOT EXISTS "maxTurns" integer NOT NULL DEFAULT 6 CHECK ("maxTurns" BETWEEN 1 AND 20),
  ADD COLUMN IF NOT EXISTS "turnCount" integer NOT NULL DEFAULT 0 CHECK ("turnCount" >= 0),
  ADD COLUMN IF NOT EXISTS "nextAttemptAt" timestamptz;

ALTER TABLE public."CompanyOsMessage"
  ADD COLUMN IF NOT EXISTS "fromAgentId" text,
  ADD COLUMN IF NOT EXISTS "toAgentId" text,
  ADD COLUMN IF NOT EXISTS "messageType" text,
  ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "schemaVersion" integer NOT NULL DEFAULT 1 CHECK ("schemaVersion" > 0),
  ADD COLUMN IF NOT EXISTS "evidenceRefs" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "correlationId" text,
  ADD COLUMN IF NOT EXISTS "causationId" text,
  ADD COLUMN IF NOT EXISTS "deliveryStatus" text NOT NULL DEFAULT 'DELIVERED',
  ADD COLUMN IF NOT EXISTS "idempotencyKey" text,
  ADD COLUMN IF NOT EXISTS "expectsResponse" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "expiresAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "deliveredAt" timestamptz;

-- V3 messages are immutable after creation. Temporarily remove only the legacy
-- append-only trigger while materializing defaults for rows that predate the
-- runtime envelope, then restore it immediately after the one-time backfill.
DROP TRIGGER IF EXISTS company_os_v3_append_only ON public."CompanyOsMessage";
UPDATE public."CompanyOsMessage" message
SET "messageType" = COALESCE(message."messageType", message.kind),
    payload = CASE WHEN message.payload = '{}'::jsonb THEN jsonb_build_object('content', message.content) ELSE message.payload END,
    "correlationId" = COALESCE(message."correlationId", company_case."requestId"),
    "deliveredAt" = COALESCE(message."deliveredAt", message."createdAt")
FROM public."CompanyOsCase" company_case
WHERE company_case.id = message."caseId";
CREATE TRIGGER company_os_v3_append_only
  BEFORE UPDATE OR DELETE ON public."CompanyOsMessage"
  FOR EACH ROW EXECUTE FUNCTION public.company_os_v3_reject_mutation();

ALTER TABLE public."CompanyOsUsage"
  DROP CONSTRAINT IF EXISTS "CompanyOsUsage_alertLevel_check";
ALTER TABLE public."CompanyOsUsage"
  ADD CONSTRAINT "CompanyOsUsage_alertLevel_runtime_check"
  CHECK ("alertLevel" IS NULL OR "alertLevel" IN (70,80,85,100));

CREATE UNIQUE INDEX IF NOT EXISTS "CompanyOsMessage_idempotencyKey_key"
  ON public."CompanyOsMessage" ("idempotencyKey") WHERE "idempotencyKey" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "CompanyOsMessage_route_createdAt_idx"
  ON public."CompanyOsMessage" ("fromAgentId", "toAgentId", "createdAt");
CREATE INDEX IF NOT EXISTS "CompanyOsMessage_correlation_createdAt_idx"
  ON public."CompanyOsMessage" ("correlationId", "createdAt");

DO $$ BEGIN
  ALTER TABLE public."CompanyOsMessage"
    ADD CONSTRAINT "CompanyOsMessage_deliveryStatus_runtime_check"
    CHECK ("deliveryStatus" IN ('PENDING','DELIVERED','EXPIRED','FAILED','CANCELLED'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE public."CompanyOsAgentContract" (
  id text PRIMARY KEY,
  "agentId" text NOT NULL,
  "contractVersion" text NOT NULL,
  name text NOT NULL,
  "reportsToAgentId" text,
  domain text NOT NULL,
  "handlerKey" text NOT NULL,
  status text NOT NULL CHECK (status IN ('INSTALLED','DISABLED')),
  contract jsonb NOT NULL CHECK (jsonb_typeof(contract) = 'object'),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("agentId", "contractVersion")
);
CREATE INDEX "CompanyOsAgentContract_current_idx"
  ON public."CompanyOsAgentContract" ("agentId", "createdAt" DESC) WHERE status = 'INSTALLED';

INSERT INTO public."CompanyOsAgentContract"
  (id, "agentId", "contractVersion", name, "reportsToAgentId", domain, "handlerKey", status, contract)
VALUES
  (
    'agent-contract:general-manager-ai-v3:3.1.0', 'general-manager-ai-v3', '3.1.0',
    'Gerente General AI', NULL, 'GENERAL_MANAGEMENT', 'general-manager-advisory', 'INSTALLED',
    jsonb_build_object(
      'acceptedTriggers', jsonb_build_array('MANUAL','AGENT_MESSAGE','DATA_QUALITY_COMPLETED'),
      'requiredSources', jsonb_build_array('COMPANY_OS_CLOSED_EVIDENCE'),
      'allowedTools', jsonb_build_array('openai.responses','company-os.read-evidence','company-os.delegate'),
      'allowedInternalTables', jsonb_build_array('CompanyOsCase','CompanyOsWorkItem','CompanyOsMessage','CompanyOsCaseEvent','CompanyOsUsage','CompanyOsMission'),
      'prohibitedTables', jsonb_build_array('Client','Product','Supplier','Order','OrderItem','Transaction','Shipment','Purchase','PurchaseItem','PurchaseAllocation','Expense','SupplierOffer','SupplierPriceListLoad','IngestionRun','IngestionItem'),
      'prohibitedActions', jsonb_build_array('PAYMENT','TRANSFER','PURCHASE','PRICE_CHANGE','INVENTORY_CHANGE','ORDER_CHANGE','CUSTOMER_CHANGE','SHIPMENT_CHANGE','EXPENSE_CHANGE','EXTERNAL_MESSAGE','DEPLOY','MERGE','INFRASTRUCTURE_CHANGE','ROLLBACK','AWS_USE','SECRET_ROTATION','SECRET_READ_OR_DISCLOSURE'),
      'timeoutMs', 120000, 'concurrency', 1,
      'budgets', jsonb_build_object('dailyTokens',48000,'monthlyTokens',1000000,'maxOutputTokens',3000,'targetTotalTokensPerAttempt',12000),
      'lowConfidencePolicy', jsonb_build_object('minConfidence',0.75,'action','ABSTAIN_AND_ESCALATE','caseStatus','NEEDS_REVIEW','escalationTarget','Diego','createReviewMessage',true),
      'inputSchemaVersion', 1, 'outputSchemaVersion', 2,
      'inputSchema', '{"type":"object","additionalProperties":false,"required":["requestId","caseId","workItemId","objective","evidencePayload","contextMessages","budgets"],"properties":{"requestId":{"type":"string"},"caseId":{"type":"string"},"workItemId":{"type":"string"},"objective":{"type":"string"},"evidencePayload":{"type":"object"},"contextMessages":{"type":"array"},"budgets":{"type":"object"}}}'::jsonb,
      'outputSchema', '{"type":"object","additionalProperties":false,"required":["summary","primaryDataQualityProblem","evidenceRefs","recommendedNextStep","missions","delegations","needsHumanDecision","confidence"],"properties":{"summary":{"type":"string"},"primaryDataQualityProblem":{"type":"string"},"evidenceRefs":{"type":"array","items":{"type":"string"}},"recommendedNextStep":{"type":"string"},"missions":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["title","objective","evidenceRefs","status"],"properties":{"title":{"type":"string"},"objective":{"type":"string"},"evidenceRefs":{"type":"array","items":{"type":"string"}},"status":{"const":"PLANNED"}}}},"delegations":{"type":"array","maxItems":3,"items":{"type":"object","additionalProperties":false,"required":["agentId","objective","evidenceRefs"],"properties":{"agentId":{"const":"systems-manager-ai-v1"},"objective":{"type":"string"},"evidenceRefs":{"type":"array","items":{"type":"string"}}}}},"needsHumanDecision":{"type":"boolean"},"confidence":{"type":"number","minimum":0,"maximum":1}}}'::jsonb,
      'escalationRules', jsonb_build_array('LOW_CONFIDENCE_TO_DIEGO','BUDGET_TO_DIEGO','SPECIALIST_FAILURE_TO_DIEGO'),
      'advisoryOnly', true
    )
  ),
  (
    'agent-contract:systems-manager-ai-v1:1.1.0', 'systems-manager-ai-v1', '1.1.0',
    'Gerente de Sistemas AI', 'general-manager-ai-v3', 'SYSTEMS', 'systems-manager-advisory', 'INSTALLED',
    jsonb_build_object(
      'acceptedTriggers', jsonb_build_array('MANUAL','AGENT_MESSAGE','SCHEDULE','INCIDENT'),
      'requiredSources', jsonb_build_array('COMPANY_OS_SYSTEM_SNAPSHOT'),
      'allowedTools', jsonb_build_array('openai.responses','company-os.read-technical-evidence'),
      'allowedInternalTables', jsonb_build_array('CompanyOsMessage','CompanyOsCaseEvent','CompanyOsUsage','CompanyOsMission','CompanyOsSystemRiskHistory'),
      'prohibitedTables', jsonb_build_array('Client','Product','Supplier','Order','OrderItem','Transaction','Shipment','Purchase','PurchaseItem','PurchaseAllocation','Expense','SupplierOffer','SupplierPriceListLoad','IngestionRun','IngestionItem'),
      'prohibitedActions', jsonb_build_array('PAYMENT','TRANSFER','PURCHASE','PRICE_CHANGE','INVENTORY_CHANGE','ORDER_CHANGE','CUSTOMER_CHANGE','SHIPMENT_CHANGE','EXPENSE_CHANGE','EXTERNAL_MESSAGE','DEPLOY','MERGE','INFRASTRUCTURE_CHANGE','ROLLBACK','AWS_USE','SECRET_ROTATION','SECRET_READ_OR_DISCLOSURE'),
      'timeoutMs', 120000, 'concurrency', 1,
      'budgets', jsonb_build_object('dailyTokens',48000,'monthlyTokens',1000000,'maxOutputTokens',3000,'targetTotalTokensPerAttempt',12000),
      'lowConfidencePolicy', jsonb_build_object('minConfidence',0.75,'action','ABSTAIN_AND_ESCALATE','caseStatus','NEEDS_REVIEW','escalationTarget','general-manager-ai-v3','createReviewMessage',true),
      'inputSchemaVersion', 1, 'outputSchemaVersion', 1,
      'inputSchema', '{"type":"object","additionalProperties":false,"required":["requestId","caseId","workItemId","objective","evidencePayload","contextMessages","budgets"],"properties":{"requestId":{"type":"string"},"caseId":{"type":"string"},"workItemId":{"type":"string"},"objective":{"type":"string"},"evidencePayload":{"type":"object"},"contextMessages":{"type":"array"},"budgets":{"type":"object"}}}'::jsonb,
      'outputSchema', '{"type":"object","additionalProperties":false,"required":["summary","primaryConfirmedRisk","primaryCoverageGap","confirmedRiskNextStep","coverageGapNextStep","evidenceRefs","actionableRisks","missions","needsHumanDecision","confidence"],"properties":{"summary":{"type":"string"},"primaryConfirmedRisk":{"type":"string"},"primaryCoverageGap":{"type":"string"},"confirmedRiskNextStep":{"type":"string"},"coverageGapNextStep":{"type":"string"},"evidenceRefs":{"type":"array","items":{"type":"string"}},"actionableRisks":{"type":"array","maxItems":5,"items":{"type":"object","additionalProperties":false,"required":["riskId","title","assetId","classification","priority","evidenceRefs"],"properties":{"riskId":{"type":"string"},"title":{"type":"string"},"assetId":{"type":"string"},"classification":{"const":"ACTION_REQUIRED"},"priority":{"type":"integer","minimum":0,"maximum":100},"evidenceRefs":{"type":"array","items":{"type":"string"}}}}},"missions":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["title","objective","evidenceRefs","status"],"properties":{"title":{"type":"string"},"objective":{"type":"string"},"evidenceRefs":{"type":"array","items":{"type":"string"}},"status":{"const":"PLANNED"}}}},"needsHumanDecision":{"type":"boolean"},"confidence":{"type":"number","minimum":0,"maximum":1}}}'::jsonb,
      'escalationRules', jsonb_build_array('CONFIRMED_RISK_TO_GENERAL_MANAGER','COVERAGE_GAP_TO_GENERAL_MANAGER','BUDGET_TO_DIEGO'),
      'advisoryOnly', true
    )
  )
ON CONFLICT ("agentId", "contractVersion") DO NOTHING;

CREATE TABLE public."CompanyOsWorkItem" (
  id text PRIMARY KEY,
  "caseId" text NOT NULL REFERENCES public."CompanyOsCase"(id) ON DELETE RESTRICT,
  "agentId" text NOT NULL,
  "triggerType" text NOT NULL CHECK ("triggerType" IN ('MANUAL','SCHEDULE','EVENT','AGENT_MESSAGE','RECOVERY','INCIDENT')),
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN (
    'QUEUED','CLAIMED','RUNNING','NEEDS_REVIEW','COMPLETED','BLOCKED',
    'FAILED_RETRYABLE','FAILED_FINAL','CANCELLED'
  )),
  priority integer NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
  "availableAt" timestamptz NOT NULL DEFAULT now(),
  "causalMessageId" text REFERENCES public."CompanyOsMessage"(id) ON DELETE RESTRICT,
  "inputPayload" jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof("inputPayload") = 'object'),
  "schemaVersion" integer NOT NULL DEFAULT 1 CHECK ("schemaVersion" > 0),
  "idempotencyKey" text NOT NULL UNIQUE,
  "maxAttempts" integer NOT NULL DEFAULT 3 CHECK ("maxAttempts" BETWEEN 1 AND 10),
  "attemptCount" integer NOT NULL DEFAULT 0 CHECK ("attemptCount" >= 0),
  "timeoutMs" integer NOT NULL DEFAULT 120000 CHECK ("timeoutMs" BETWEEN 1000 AND 600000),
  "reservedTokens" integer NOT NULL DEFAULT 12000 CHECK ("reservedTokens" >= 0),
  "nextAttemptAt" timestamptz,
  "completedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, "caseId", "agentId")
);
CREATE INDEX "CompanyOsWorkItem_claim_idx"
  ON public."CompanyOsWorkItem" (status, "availableAt", priority DESC, "createdAt");
CREATE INDEX "CompanyOsWorkItem_case_status_idx"
  ON public."CompanyOsWorkItem" ("caseId", status, "createdAt");
CREATE INDEX "CompanyOsWorkItem_agent_status_idx"
  ON public."CompanyOsWorkItem" ("agentId", status, "availableAt");

CREATE TABLE public."CompanyOsRuntimeSlot" (
  "slotNo" integer PRIMARY KEY CHECK ("slotNo" BETWEEN 1 AND 2),
  "leaseToken" text,
  "agentId" text,
  "workerId" text,
  "expiresAt" timestamptz,
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public."CompanyOsRuntimeSlot" ("slotNo") VALUES (1), (2)
ON CONFLICT ("slotNo") DO NOTHING;

ALTER TABLE public."CompanyOsLease"
  ADD COLUMN IF NOT EXISTS "workItemId" text,
  ADD COLUMN IF NOT EXISTS "agentId" text NOT NULL DEFAULT 'general-manager-ai-v3',
  ADD COLUMN IF NOT EXISTS "workerId" text NOT NULL DEFAULT 'legacy-hostinger-company-os-v3',
  ADD COLUMN IF NOT EXISTS "instanceId" text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS "slotNo" integer,
  ADD COLUMN IF NOT EXISTS "renewedAt" timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "reservedTokens" integer NOT NULL DEFAULT 0 CHECK ("reservedTokens" >= 0);

UPDATE public."CompanyOsLease" lease
SET "agentId" = company_case."agentId"
FROM public."CompanyOsCase" company_case
WHERE company_case.id = lease."caseId";

DO $$ BEGIN
  ALTER TABLE public."CompanyOsLease"
    ADD CONSTRAINT "CompanyOsLease_workItemId_fkey"
    FOREIGN KEY ("workItemId") REFERENCES public."CompanyOsWorkItem"(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public."CompanyOsLease"
    ADD CONSTRAINT "CompanyOsLease_slotNo_fkey"
    FOREIGN KEY ("slotNo") REFERENCES public."CompanyOsRuntimeSlot"("slotNo") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX "CompanyOsLease_active_work_item_key"
  ON public."CompanyOsLease" ("workItemId") WHERE status = 'ACTIVE' AND "workItemId" IS NOT NULL;
CREATE UNIQUE INDEX "CompanyOsLease_active_agent_key"
  ON public."CompanyOsLease" ("agentId") WHERE status = 'ACTIVE' AND "workItemId" IS NOT NULL;
CREATE UNIQUE INDEX "CompanyOsLease_active_slot_key"
  ON public."CompanyOsLease" ("slotNo") WHERE status = 'ACTIVE' AND "slotNo" IS NOT NULL;
CREATE INDEX "CompanyOsLease_worker_status_idx"
  ON public."CompanyOsLease" ("workerId", status, "expiresAt");

ALTER TABLE public."CompanyOsExecutionAttempt"
  ADD COLUMN IF NOT EXISTS "workItemId" text,
  ADD COLUMN IF NOT EXISTS "agentId" text,
  ADD COLUMN IF NOT EXISTS "workerId" text,
  ADD COLUMN IF NOT EXISTS "instanceId" text,
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS "durationMs" integer CHECK ("durationMs" IS NULL OR "durationMs" >= 0),
  ADD COLUMN IF NOT EXISTS "inputTokens" integer CHECK ("inputTokens" IS NULL OR "inputTokens" >= 0),
  ADD COLUMN IF NOT EXISTS "outputTokens" integer CHECK ("outputTokens" IS NULL OR "outputTokens" >= 0),
  ADD COLUMN IF NOT EXISTS "totalTokens" integer CHECK ("totalTokens" IS NULL OR "totalTokens" >= 0),
  ADD COLUMN IF NOT EXISTS "estimatedCostUsd" numeric(12,6) CHECK ("estimatedCostUsd" IS NULL OR "estimatedCostUsd" >= 0),
  ADD COLUMN IF NOT EXISTS "timeoutAt" timestamptz;
DO $$ BEGIN
  ALTER TABLE public."CompanyOsExecutionAttempt"
    ADD CONSTRAINT "CompanyOsExecutionAttempt_workItemId_fkey"
    FOREIGN KEY ("workItemId") REFERENCES public."CompanyOsWorkItem"(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX "CompanyOsExecutionAttempt_workItem_startedAt_idx"
  ON public."CompanyOsExecutionAttempt" ("workItemId", "startedAt");

ALTER TABLE public."CompanyOsUsage"
  ADD COLUMN IF NOT EXISTS "attemptId" text,
  ADD COLUMN IF NOT EXISTS "agentId" text,
  ADD COLUMN IF NOT EXISTS "workerId" text,
  ADD COLUMN IF NOT EXISTS outcome text NOT NULL DEFAULT 'SUCCEEDED';
DO $$ BEGIN
  ALTER TABLE public."CompanyOsUsage"
    ADD CONSTRAINT "CompanyOsUsage_attemptId_fkey"
    FOREIGN KEY ("attemptId") REFERENCES public."CompanyOsExecutionAttempt"(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE UNIQUE INDEX "CompanyOsUsage_attemptId_key"
  ON public."CompanyOsUsage" ("attemptId") WHERE "attemptId" IS NOT NULL;
CREATE INDEX "CompanyOsUsage_agent_createdAt_idx"
  ON public."CompanyOsUsage" ("agentId", "createdAt");

CREATE TABLE public."CompanyOsWorker" (
  "workerId" text PRIMARY KEY,
  "instanceId" text NOT NULL,
  host text NOT NULL,
  version text NOT NULL,
  state text NOT NULL CHECK (state IN ('STARTING','IDLE','BUSY','DEGRADED','DRAINING','STOPPED')),
  "startedAt" timestamptz NOT NULL,
  "lastHeartbeatAt" timestamptz NOT NULL,
  "currentWork" jsonb NOT NULL DEFAULT '[]'::jsonb,
  capacity integer NOT NULL DEFAULT 2 CHECK (capacity BETWEEN 1 AND 2),
  "allowedAgentIds" text[] NOT NULL DEFAULT '{}'::text[],
  "lastErrorCode" text,
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public."CompanyOsWorkerHeartbeat" (
  id text PRIMARY KEY,
  "workerId" text NOT NULL REFERENCES public."CompanyOsWorker"("workerId") ON DELETE RESTRICT,
  "instanceId" text NOT NULL,
  state text NOT NULL CHECK (state IN ('STARTING','IDLE','BUSY','DEGRADED','DRAINING','STOPPED')),
  "currentWork" jsonb NOT NULL DEFAULT '[]'::jsonb,
  host text NOT NULL,
  version text NOT NULL,
  "observedAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "CompanyOsWorkerHeartbeat_worker_observed_idx"
  ON public."CompanyOsWorkerHeartbeat" ("workerId", "observedAt" DESC);

CREATE TABLE public."CompanyOsDependencyObservation" (
  id text PRIMARY KEY,
  "dependencyKey" text NOT NULL,
  status text NOT NULL CHECK (status IN ('HEALTHY','DEGRADED','UNAVAILABLE','UNOBSERVED')),
  "workerId" text,
  "caseId" text REFERENCES public."CompanyOsCase"(id) ON DELETE RESTRICT,
  "latencyMs" integer CHECK ("latencyMs" IS NULL OR "latencyMs" >= 0),
  detail text,
  "observedAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "CompanyOsDependencyObservation_latest_idx"
  ON public."CompanyOsDependencyObservation" ("dependencyKey", "observedAt" DESC);

CREATE TABLE public."CompanyOsIncident" (
  id text PRIMARY KEY,
  "dedupeKey" text NOT NULL UNIQUE,
  type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('INFO','WARNING','CRITICAL')),
  status text NOT NULL CHECK (status IN ('OPEN','ACKNOWLEDGED','RESOLVED')),
  summary text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  "occurrenceCount" integer NOT NULL DEFAULT 1 CHECK ("occurrenceCount" > 0),
  "firstSeenAt" timestamptz NOT NULL,
  "lastSeenAt" timestamptz NOT NULL,
  "notifiedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "CompanyOsIncident_status_severity_idx"
  ON public."CompanyOsIncident" (status, severity, "lastSeenAt" DESC);

CREATE TABLE public."CompanyOsRuntimeControl" (
  id text PRIMARY KEY,
  paused boolean NOT NULL DEFAULT false,
  "globalConcurrency" integer NOT NULL DEFAULT 2 CHECK ("globalConcurrency" BETWEEN 1 AND 2),
  "pollIntervalMs" integer NOT NULL DEFAULT 15000 CHECK ("pollIntervalMs" BETWEEN 5000 AND 300000),
  "heartbeatIntervalMs" integer NOT NULL DEFAULT 60000 CHECK ("heartbeatIntervalMs" BETWEEN 10000 AND 300000),
  "leaseMs" integer NOT NULL DEFAULT 300000 CHECK ("leaseMs" BETWEEN 60000 AND 900000),
  "leaseRenewMs" integer NOT NULL DEFAULT 30000 CHECK ("leaseRenewMs" BETWEEN 10000 AND 120000),
  "shutdownGraceMs" integer NOT NULL DEFAULT 30000 CHECK ("shutdownGraceMs" BETWEEN 1000 AND 60000),
  "updatedBy" text NOT NULL DEFAULT 'migration',
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public."CompanyOsRuntimeControl" (id) VALUES ('primary')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE public."CompanyOsWorkerRequestNonce" (
  nonce text PRIMARY KEY,
  "workerId" text NOT NULL,
  endpoint text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "expiresAt" timestamptz NOT NULL
);
CREATE INDEX "CompanyOsWorkerRequestNonce_rate_idx"
  ON public."CompanyOsWorkerRequestNonce" ("workerId", "createdAt" DESC);
CREATE INDEX "CompanyOsWorkerRequestNonce_expiry_idx"
  ON public."CompanyOsWorkerRequestNonce" ("expiresAt");

CREATE OR REPLACE FUNCTION public.company_os_runtime_guard_case_transition() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NOT (
    (OLD.status = 'QUEUED' AND NEW.status IN ('CLAIMED','ANALYZING','BLOCKED','FAILED_FINAL','CANCELLED')) OR
    (OLD.status = 'CLAIMED' AND NEW.status IN ('RUNNING','QUEUED','FAILED_RETRYABLE','FAILED_FINAL','BLOCKED','CANCELLED')) OR
    (OLD.status = 'RUNNING' AND NEW.status IN ('NEEDS_REVIEW','COMPLETED','FAILED_RETRYABLE','FAILED_FINAL','BLOCKED','CANCELLED')) OR
    (OLD.status = 'FAILED_RETRYABLE' AND NEW.status IN ('QUEUED','CLAIMED','FAILED_FINAL','BLOCKED','CANCELLED')) OR
    (OLD.status = 'NEEDS_REVIEW' AND NEW.status IN ('COMPLETED','BLOCKED','CANCELLED')) OR
    (OLD.status = 'BLOCKED' AND NEW.status IN ('QUEUED','FAILED_FINAL','CANCELLED')) OR
    (OLD.status = 'FAILED_FINAL' AND NEW.status = 'QUEUED') OR
    (OLD.status = 'ANALYZING' AND NEW.status IN ('AWAITING_REVIEW','COMPLETED','FAILED','BLOCKED','CANCELLED')) OR
    (OLD.status = 'FAILED' AND NEW.status IN ('ANALYZING','QUEUED','FAILED_FINAL','BLOCKED','CANCELLED')) OR
    (OLD.status = 'AWAITING_REVIEW' AND NEW.status IN ('COMPLETED','BLOCKED','CANCELLED'))
  ) THEN
    RAISE EXCEPTION 'Invalid Company OS case transition: % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS company_os_runtime_case_transition_guard ON public."CompanyOsCase";
CREATE TRIGGER company_os_runtime_case_transition_guard
  BEFORE UPDATE OF status ON public."CompanyOsCase"
  FOR EACH ROW EXECUTE FUNCTION public.company_os_runtime_guard_case_transition();

CREATE OR REPLACE FUNCTION public.company_os_runtime_guard_work_item_transition() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NOT (
    (OLD.status = 'QUEUED' AND NEW.status IN ('CLAIMED','BLOCKED','FAILED_FINAL','CANCELLED')) OR
    (OLD.status = 'CLAIMED' AND NEW.status IN ('RUNNING','QUEUED','FAILED_RETRYABLE','FAILED_FINAL','BLOCKED','CANCELLED')) OR
    (OLD.status = 'RUNNING' AND NEW.status IN ('NEEDS_REVIEW','COMPLETED','FAILED_RETRYABLE','FAILED_FINAL','BLOCKED','CANCELLED')) OR
    (OLD.status = 'FAILED_RETRYABLE' AND NEW.status IN ('QUEUED','FAILED_FINAL','BLOCKED','CANCELLED')) OR
    (OLD.status = 'NEEDS_REVIEW' AND NEW.status IN ('COMPLETED','BLOCKED','CANCELLED')) OR
    (OLD.status = 'BLOCKED' AND NEW.status IN ('QUEUED','FAILED_FINAL','CANCELLED')) OR
    (OLD.status = 'FAILED_FINAL' AND NEW.status = 'QUEUED')
  ) THEN
    RAISE EXCEPTION 'Invalid Company OS work item transition: % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER company_os_runtime_work_item_transition_guard
  BEFORE UPDATE OF status ON public."CompanyOsWorkItem"
  FOR EACH ROW EXECUTE FUNCTION public.company_os_runtime_guard_work_item_transition();

DO $$ DECLARE relation_name text; BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'CompanyOsAgentContract','CompanyOsWorkerHeartbeat','CompanyOsDependencyObservation'
  ] LOOP
    EXECUTE format('CREATE TRIGGER company_os_runtime_append_only BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.company_os_v3_reject_mutation()', relation_name);
  END LOOP;
END $$;

DO $$ DECLARE relation_name text; BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'CompanyOsAgentContract','CompanyOsWorkItem','CompanyOsRuntimeSlot','CompanyOsWorker',
    'CompanyOsWorkerHeartbeat','CompanyOsDependencyObservation','CompanyOsIncident',
    'CompanyOsRuntimeControl','CompanyOsWorkerRequestNonce'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', relation_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', relation_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated, company_os_reader', relation_name);
  END LOOP;
END $$;

GRANT SELECT ON public."CompanyOsAgentContract", public."CompanyOsRuntimeSlot",
  public."CompanyOsWorker", public."CompanyOsWorkerHeartbeat", public."CompanyOsDependencyObservation",
  public."CompanyOsIncident", public."CompanyOsRuntimeControl", public."CompanyOsWorkerRequestNonce",
  public."CompanyOsWorkItem" TO company_os_v3;
GRANT INSERT ON public."CompanyOsWorkItem", public."CompanyOsWorker", public."CompanyOsWorkerHeartbeat",
  public."CompanyOsDependencyObservation", public."CompanyOsIncident", public."CompanyOsWorkerRequestNonce"
TO company_os_v3;
GRANT UPDATE ON public."CompanyOsWorkItem", public."CompanyOsRuntimeSlot", public."CompanyOsWorker",
  public."CompanyOsIncident", public."CompanyOsRuntimeControl" TO company_os_v3;
GRANT DELETE ON public."CompanyOsWorkerRequestNonce" TO company_os_v3;

CREATE POLICY company_os_runtime_contract_select ON public."CompanyOsAgentContract"
  FOR SELECT TO company_os_v3 USING (true);
CREATE POLICY company_os_runtime_work_item_select ON public."CompanyOsWorkItem"
  FOR SELECT TO company_os_v3 USING (true);
CREATE POLICY company_os_runtime_work_item_insert ON public."CompanyOsWorkItem"
  FOR INSERT TO company_os_v3 WITH CHECK (true);
CREATE POLICY company_os_runtime_work_item_update ON public."CompanyOsWorkItem"
  FOR UPDATE TO company_os_v3 USING (true) WITH CHECK (true);
CREATE POLICY company_os_runtime_slot_select ON public."CompanyOsRuntimeSlot"
  FOR SELECT TO company_os_v3 USING (true);
CREATE POLICY company_os_runtime_slot_update ON public."CompanyOsRuntimeSlot"
  FOR UPDATE TO company_os_v3 USING (true) WITH CHECK (true);
CREATE POLICY company_os_runtime_worker_select ON public."CompanyOsWorker"
  FOR SELECT TO company_os_v3 USING (true);
CREATE POLICY company_os_runtime_worker_insert ON public."CompanyOsWorker"
  FOR INSERT TO company_os_v3 WITH CHECK (true);
CREATE POLICY company_os_runtime_worker_update ON public."CompanyOsWorker"
  FOR UPDATE TO company_os_v3 USING (true) WITH CHECK (true);
CREATE POLICY company_os_runtime_worker_heartbeat_select ON public."CompanyOsWorkerHeartbeat"
  FOR SELECT TO company_os_v3 USING (true);
CREATE POLICY company_os_runtime_worker_heartbeat_insert ON public."CompanyOsWorkerHeartbeat"
  FOR INSERT TO company_os_v3 WITH CHECK (true);
CREATE POLICY company_os_runtime_dependency_select ON public."CompanyOsDependencyObservation"
  FOR SELECT TO company_os_v3 USING (true);
CREATE POLICY company_os_runtime_dependency_insert ON public."CompanyOsDependencyObservation"
  FOR INSERT TO company_os_v3 WITH CHECK (true);
CREATE POLICY company_os_runtime_incident_select ON public."CompanyOsIncident"
  FOR SELECT TO company_os_v3 USING (true);
CREATE POLICY company_os_runtime_incident_insert ON public."CompanyOsIncident"
  FOR INSERT TO company_os_v3 WITH CHECK (true);
CREATE POLICY company_os_runtime_incident_update ON public."CompanyOsIncident"
  FOR UPDATE TO company_os_v3 USING (true) WITH CHECK (true);
CREATE POLICY company_os_runtime_control_select ON public."CompanyOsRuntimeControl"
  FOR SELECT TO company_os_v3 USING (true);
CREATE POLICY company_os_runtime_control_update ON public."CompanyOsRuntimeControl"
  FOR UPDATE TO company_os_v3 USING (true) WITH CHECK (true);
CREATE POLICY company_os_runtime_nonce_select ON public."CompanyOsWorkerRequestNonce"
  FOR SELECT TO company_os_v3 USING (true);
CREATE POLICY company_os_runtime_nonce_insert ON public."CompanyOsWorkerRequestNonce"
  FOR INSERT TO company_os_v3 WITH CHECK (true);
CREATE POLICY company_os_runtime_nonce_delete ON public."CompanyOsWorkerRequestNonce"
  FOR DELETE TO company_os_v3 USING (true);

GRANT UPDATE (status, "nextAttemptAt", "turnCount", "completedAt", "updatedAt")
  ON public."CompanyOsCase" TO company_os_v3;

REVOKE ALL ON FUNCTION public.company_os_runtime_guard_case_transition() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.company_os_runtime_guard_work_item_transition() FROM PUBLIC;

COMMENT ON TABLE public."CompanyOsWorkItem" IS 'Durable per-agent inbox within a Company OS case; the scheduler and agent delegation enqueue work but never invoke a model directly.';
COMMENT ON TABLE public."CompanyOsWorkerHeartbeat" IS 'Append-only worker liveness independent of case activity; stale telemetry derives UNKNOWN, never OFFLINE.';
COMMENT ON TABLE public."CompanyOsDependencyObservation" IS 'Append-only runtime dependency evidence using HEALTHY, DEGRADED, UNAVAILABLE, or UNOBSERVED.';
COMMENT ON TABLE public."CompanyOsAgentContract" IS 'Append-only versioned executable agent contracts. Missing agents are represented as NOT_INSTALLED in the application manifest, not as runtime rows.';
COMMENT ON TABLE public."CompanyOsRuntimeControl" IS 'Human-controlled pause and bounded runtime configuration. Advisory approval never changes this row.';

COMMIT;

-- Controlled rollback is data-preserving: pause runtime, deploy the previous app,
-- and leave these additive tables/columns in place. A destructive DROP rollback is
-- intentionally excluded from automatic execution and documented in Company OS.
