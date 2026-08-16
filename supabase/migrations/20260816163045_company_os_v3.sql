-- Company OS V3: advisory-only control plane. No operational business table is modified.
BEGIN;
DO $$ BEGIN
  CREATE ROLE company_os_v3 NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public."CompanyOsCase" (
  id text PRIMARY KEY,
  "requestId" text NOT NULL UNIQUE,
  objective text NOT NULL,
  "objectiveHash" text NOT NULL,
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','ANALYZING','AWAITING_REVIEW','BLOCKED','FAILED','CANCELLED','COMPLETED')),
  "actorRef" text NOT NULL,
  "authMode" text NOT NULL,
  "relatedCaseId" text,
  "inputBudgetEstimate" integer NOT NULL CHECK ("inputBudgetEstimate" >= 0),
  "maxOutputTokens" integer NOT NULL DEFAULT 3000 CHECK ("maxOutputTokens" > 0),
  "targetTotalTokens" integer NOT NULL DEFAULT 12000 CHECK ("targetTotalTokens" >= "maxOutputTokens"),
  "webhookDeliveryStatus" text NOT NULL DEFAULT 'PENDING' CHECK ("webhookDeliveryStatus" IN ('PENDING','DELIVERED','FAILED','RECOVERED')),
  "cancellationReason" text,
  "completedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "CompanyOsCase_status_createdAt_idx" ON public."CompanyOsCase" (status, "createdAt");
CREATE INDEX IF NOT EXISTS "CompanyOsCase_relatedCaseId_idx" ON public."CompanyOsCase" ("relatedCaseId");

CREATE TABLE IF NOT EXISTS public."CompanyOsMessage" (
  id text PRIMARY KEY, "caseId" text NOT NULL REFERENCES public."CompanyOsCase"(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('USER','ASSISTANT','SYSTEM')),
  kind text NOT NULL CHECK (kind IN ('ORDER','CONTEXT','RESPONSE','RESULT','STATUS')),
  content text NOT NULL, "actorRef" text NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "CompanyOsMessage_caseId_createdAt_idx" ON public."CompanyOsMessage" ("caseId", "createdAt");

CREATE TABLE IF NOT EXISTS public."CompanyOsCaseEvent" (
  id text PRIMARY KEY, "caseId" text NOT NULL REFERENCES public."CompanyOsCase"(id) ON DELETE RESTRICT,
  sequence integer NOT NULL, "eventType" text NOT NULL, "fromStatus" text, "toStatus" text,
  payload jsonb NOT NULL, "idempotencyKey" text NOT NULL, "previousHash" text, "eventHash" text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("caseId", sequence), UNIQUE ("caseId", "idempotencyKey")
);
CREATE INDEX IF NOT EXISTS "CompanyOsCaseEvent_caseId_createdAt_idx" ON public."CompanyOsCaseEvent" ("caseId", "createdAt");

CREATE TABLE IF NOT EXISTS public."CompanyOsEvidenceRef" (
  id text PRIMARY KEY, "caseId" text NOT NULL REFERENCES public."CompanyOsCase"(id) ON DELETE RESTRICT,
  "evidenceKey" text NOT NULL, "sourceRef" text NOT NULL, value jsonb NOT NULL,
  critical boolean NOT NULL DEFAULT false, "observedAt" timestamptz, "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("caseId", "evidenceKey")
);
CREATE INDEX IF NOT EXISTS "CompanyOsEvidenceRef_caseId_createdAt_idx" ON public."CompanyOsEvidenceRef" ("caseId", "createdAt");

CREATE TABLE IF NOT EXISTS public."CompanyOsMission" (
  id text PRIMARY KEY, "caseId" text NOT NULL REFERENCES public."CompanyOsCase"(id) ON DELETE RESTRICT,
  title text NOT NULL, rationale text NOT NULL, "expectedOutput" text NOT NULL,
  status text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','APPROVED','REJECTED','REVIEW','BLOCKED','RUNNING','DONE')),
  "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, "caseId")
);
CREATE INDEX IF NOT EXISTS "CompanyOsMission_caseId_status_idx" ON public."CompanyOsMission" ("caseId", status);

CREATE TABLE IF NOT EXISTS public."CompanyOsDecision" (
  id text PRIMARY KEY, "caseId" text NOT NULL REFERENCES public."CompanyOsCase"(id) ON DELETE RESTRICT,
  "missionId" text,
  decision text NOT NULL CHECK (decision IN ('APPROVE','REJECT','REQUEST_REVIEW','BLOCK')),
  reason text, "actorRef" text NOT NULL, "idempotencyKey" text NOT NULL UNIQUE,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY ("missionId", "caseId") REFERENCES public."CompanyOsMission"(id, "caseId") ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS "CompanyOsDecision_caseId_createdAt_idx" ON public."CompanyOsDecision" ("caseId", "createdAt");

CREATE TABLE IF NOT EXISTS public."CompanyOsAuditEvent" (
  id text PRIMARY KEY, "requestId" text NOT NULL, action text NOT NULL, "actorRef" text NOT NULL,
  metadata jsonb NOT NULL, "idempotencyKey" text NOT NULL UNIQUE, "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "CompanyOsAuditEvent_requestId_createdAt_idx" ON public."CompanyOsAuditEvent" ("requestId", "createdAt");

CREATE TABLE IF NOT EXISTS public."CompanyOsUsage" (
  id text PRIMARY KEY, "caseId" text NOT NULL REFERENCES public."CompanyOsCase"(id) ON DELETE RESTRICT,
  provider text NOT NULL, model text NOT NULL, "inputTokens" integer NOT NULL CHECK ("inputTokens" >= 0),
  "cachedTokens" integer NOT NULL CHECK ("cachedTokens" >= 0), "cacheWriteTokens" integer NOT NULL DEFAULT 0 CHECK ("cacheWriteTokens" >= 0),
  "outputTokens" integer NOT NULL CHECK ("outputTokens" >= 0), "reasoningTokens" integer NOT NULL CHECK ("reasoningTokens" >= 0),
  "totalTokens" integer NOT NULL CHECK ("totalTokens" >= 0), "estimatedCostUsd" numeric(12,6) NOT NULL CHECK ("estimatedCostUsd" >= 0),
  "dailyTotalTokens" integer NOT NULL CHECK ("dailyTotalTokens" >= 0), "dailyCostUsd" numeric(12,6) NOT NULL CHECK ("dailyCostUsd" >= 0),
  "alertLevel" integer CHECK ("alertLevel" IN (70,85,100)), "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "CompanyOsUsage_caseId_createdAt_idx" ON public."CompanyOsUsage" ("caseId", "createdAt");
CREATE INDEX IF NOT EXISTS "CompanyOsUsage_createdAt_idx" ON public."CompanyOsUsage" ("createdAt");

CREATE TABLE IF NOT EXISTS public."CompanyOsLock" (
  "requestId" text PRIMARY KEY, "ownerToken" text NOT NULL UNIQUE, "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "CompanyOsLock_expiresAt_idx" ON public."CompanyOsLock" ("expiresAt");

CREATE TABLE IF NOT EXISTS public."CompanyOsLease" (
  id text PRIMARY KEY, "caseId" text NOT NULL REFERENCES public."CompanyOsCase"(id) ON DELETE RESTRICT,
  "requestId" text NOT NULL, "leaseToken" text NOT NULL UNIQUE, "ownerRef" text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RELEASED','EXPIRED','COMPLETED','FAILED')),
  "expiresAt" timestamptz NOT NULL, "releasedAt" timestamptz, "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("requestId", "leaseToken", "caseId")
);
CREATE INDEX IF NOT EXISTS "CompanyOsLease_requestId_status_expiresAt_idx" ON public."CompanyOsLease" ("requestId", status, "expiresAt");
CREATE INDEX IF NOT EXISTS "CompanyOsLease_caseId_createdAt_idx" ON public."CompanyOsLease" ("caseId", "createdAt");

CREATE TABLE IF NOT EXISTS public."CompanyOsHeartbeat" (
  id text PRIMARY KEY, "caseId" text NOT NULL REFERENCES public."CompanyOsCase"(id) ON DELETE RESTRICT,
  "requestId" text NOT NULL, "leaseToken" text NOT NULL, "workerRef" text NOT NULL, phase text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY ("requestId", "leaseToken", "caseId") REFERENCES public."CompanyOsLease"("requestId", "leaseToken", "caseId") ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS "CompanyOsHeartbeat_requestId_createdAt_idx" ON public."CompanyOsHeartbeat" ("requestId", "createdAt");

CREATE TABLE IF NOT EXISTS public."CompanyOsExecutionAttempt" (
  id text PRIMARY KEY, "caseId" text NOT NULL REFERENCES public."CompanyOsCase"(id) ON DELETE RESTRICT,
  "requestId" text NOT NULL, "leaseToken" text NOT NULL, attempt integer NOT NULL CHECK (attempt > 0),
  outcome text NOT NULL CHECK (outcome IN ('STARTED','SUCCEEDED','FAILED','TIMED_OUT','DUPLICATE_SKIPPED')),
  "errorCode" text, detail text, "startedAt" timestamptz NOT NULL DEFAULT now(), "finishedAt" timestamptz,
  UNIQUE ("requestId", attempt),
  FOREIGN KEY ("requestId", "leaseToken", "caseId") REFERENCES public."CompanyOsLease"("requestId", "leaseToken", "caseId") ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS "CompanyOsExecutionAttempt_caseId_startedAt_idx" ON public."CompanyOsExecutionAttempt" ("caseId", "startedAt");

CREATE TABLE IF NOT EXISTS public."CompanyOsNotificationDelivery" (
  id text PRIMARY KEY, "caseId" text NOT NULL REFERENCES public."CompanyOsCase"(id) ON DELETE RESTRICT,
  "requestId" text NOT NULL, channel text NOT NULL CHECK (channel IN ('WEBHOOK','TELEGRAM')),
  "eventType" text NOT NULL, status text NOT NULL CHECK (status IN ('PENDING','DELIVERED','FAILED','SKIPPED')),
  attempt integer NOT NULL CHECK (attempt > 0), "responseCode" integer, "errorDetail" text,
  "idempotencyKey" text NOT NULL UNIQUE, "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "CompanyOsNotificationDelivery_requestId_channel_createdAt_idx" ON public."CompanyOsNotificationDelivery" ("requestId", channel, "createdAt");

CREATE OR REPLACE FUNCTION public.company_os_v3_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Company OS V3 append-only relation'; END $$;

DO $$ DECLARE relation_name text; BEGIN
  FOREACH relation_name IN ARRAY ARRAY['CompanyOsMessage','CompanyOsCaseEvent','CompanyOsEvidenceRef','CompanyOsDecision','CompanyOsAuditEvent','CompanyOsUsage','CompanyOsHeartbeat','CompanyOsNotificationDelivery']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS company_os_v3_append_only ON public.%I', relation_name);
    EXECUTE format('CREATE TRIGGER company_os_v3_append_only BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.company_os_v3_reject_mutation()', relation_name);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.company_os_v3_guard_mission_status() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE expected_decision text;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status <> 'PLANNED' THEN
    RAISE EXCEPTION 'Company OS V3 missions must start PLANNED';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IN ('RUNNING','DONE') THEN
      RAISE EXCEPTION 'Company OS V3 cannot execute missions';
    END IF;
    expected_decision := CASE NEW.status
      WHEN 'APPROVED' THEN 'APPROVE' WHEN 'REJECTED' THEN 'REJECT'
      WHEN 'REVIEW' THEN 'REQUEST_REVIEW' WHEN 'BLOCKED' THEN 'BLOCK' ELSE NULL END;
    IF expected_decision IS NULL OR NOT EXISTS (
      SELECT 1 FROM public."CompanyOsDecision" d
      WHERE d."missionId" = NEW.id AND d."caseId" = NEW."caseId" AND d.decision = expected_decision
    ) THEN RAISE EXCEPTION 'Mission transition lacks a matching human decision'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS company_os_v3_mission_status_guard ON public."CompanyOsMission";
CREATE TRIGGER company_os_v3_mission_status_guard BEFORE INSERT OR UPDATE OF status ON public."CompanyOsMission"
FOR EACH ROW EXECUTE FUNCTION public.company_os_v3_guard_mission_status();

DO $$ DECLARE relation_name text; BEGIN
  FOREACH relation_name IN ARRAY ARRAY['CompanyOsCase','CompanyOsMessage','CompanyOsCaseEvent','CompanyOsEvidenceRef','CompanyOsMission','CompanyOsDecision','CompanyOsAuditEvent','CompanyOsUsage','CompanyOsLock','CompanyOsLease','CompanyOsHeartbeat','CompanyOsExecutionAttempt','CompanyOsNotificationDelivery']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', relation_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', relation_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated, company_os_reader', relation_name);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE public.%I TO company_os_v3', relation_name);
    EXECUTE format('CREATE POLICY company_os_v3_select ON public.%I FOR SELECT TO company_os_v3 USING (true)', relation_name);
    EXECUTE format('CREATE POLICY company_os_v3_insert ON public.%I FOR INSERT TO company_os_v3 WITH CHECK (true)', relation_name);
  END LOOP;
END $$;

GRANT UPDATE (status, "webhookDeliveryStatus", "cancellationReason", "completedAt", "updatedAt") ON public."CompanyOsCase" TO company_os_v3;
GRANT UPDATE (status, "updatedAt") ON public."CompanyOsMission" TO company_os_v3;
GRANT UPDATE, DELETE ON public."CompanyOsLock" TO company_os_v3;
GRANT UPDATE ON public."CompanyOsLease", public."CompanyOsExecutionAttempt" TO company_os_v3;
CREATE POLICY company_os_v3_update_case ON public."CompanyOsCase" FOR UPDATE TO company_os_v3 USING (true) WITH CHECK (true);
CREATE POLICY company_os_v3_update_mission ON public."CompanyOsMission" FOR UPDATE TO company_os_v3 USING (true) WITH CHECK (true);
CREATE POLICY company_os_v3_update_lock ON public."CompanyOsLock" FOR UPDATE TO company_os_v3 USING (true) WITH CHECK (true);
CREATE POLICY company_os_v3_update_lease ON public."CompanyOsLease" FOR UPDATE TO company_os_v3 USING (true) WITH CHECK (true);
CREATE POLICY company_os_v3_update_attempt ON public."CompanyOsExecutionAttempt" FOR UPDATE TO company_os_v3 USING (true) WITH CHECK (true);
CREATE POLICY company_os_v3_delete_lock ON public."CompanyOsLock" FOR DELETE TO company_os_v3 USING (true);

REVOKE ALL ON FUNCTION public.company_os_v3_reject_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.company_os_v3_guard_mission_status() FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO company_os_v3;
COMMIT;
