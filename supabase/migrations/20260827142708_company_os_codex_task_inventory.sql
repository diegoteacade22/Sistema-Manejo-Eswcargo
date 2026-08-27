-- Human task inventory for Company OS. Stores only sanitized metadata, never raw Codex messages.
BEGIN;

CREATE TABLE public."CompanyOsCodexTask" (
  id text PRIMARY KEY,
  "threadId" text NOT NULL UNIQUE CHECK ("threadId" ~ '^[A-Za-z0-9_-]{8,128}$'),
  "sourceHost" text NOT NULL CHECK (length("sourceHost") BETWEEN 1 AND 120),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 240),
  "projectName" text NOT NULL CHECK (length("projectName") BETWEEN 1 AND 160),
  category text NOT NULL DEFAULT 'GENERAL' CHECK (category IN ('GENERAL','SYSTEMS','OPERATIONS','COMMERCIAL','FINANCE','CUSTOMERS','PERSONAL','MONITOR')),
  "humanStatus" text NOT NULL DEFAULT 'UNREVIEWED' CHECK ("humanStatus" IN ('UNREVIEWED','PENDING','IN_PROGRESS','NEEDS_DIEGO','BLOCKED','READY_REVIEW','DONE','MONITORING','DISCARDED')),
  "sourceStatus" text NOT NULL DEFAULT 'UNKNOWN' CHECK ("sourceStatus" IN ('ACTIVE','IDLE','NOT_LOADED','ARCHIVED','UNKNOWN')),
  priority integer NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  "nextAction" text NOT NULL CHECK (length("nextAction") BETWEEN 1 AND 500),
  "attentionReason" text CHECK ("attentionReason" IS NULL OR length("attentionReason") <= 500),
  "autonomyLevel" text NOT NULL DEFAULT 'A0' CHECK ("autonomyLevel" IN ('A0','A1','A2','HUMAN')),
  "codexUrl" text NOT NULL CHECK ("codexUrl" ~ '^codex://threads/[A-Za-z0-9_-]{8,128}$'),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  "sourceUpdatedAt" timestamptz NOT NULL,
  "lastStartedAt" timestamptz,
  "lastCompletedAt" timestamptz,
  "lastObservedAt" timestamptz NOT NULL,
  archived boolean NOT NULL DEFAULT false,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "CompanyOsCodexTask_status_priority_updated_idx"
  ON public."CompanyOsCodexTask" ("humanStatus", priority, "sourceUpdatedAt" DESC);
CREATE INDEX "CompanyOsCodexTask_project_status_updated_idx"
  ON public."CompanyOsCodexTask" ("projectName", "humanStatus", "sourceUpdatedAt" DESC);
CREATE INDEX "CompanyOsCodexTask_host_observed_idx"
  ON public."CompanyOsCodexTask" ("sourceHost", "lastObservedAt" DESC);

CREATE TABLE public."CompanyOsCodexTaskObservation" (
  id text PRIMARY KEY,
  "taskId" text NOT NULL REFERENCES public."CompanyOsCodexTask"(id) ON DELETE RESTRICT,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  "humanStatus" text NOT NULL CHECK ("humanStatus" IN ('UNREVIEWED','PENDING','IN_PROGRESS','NEEDS_DIEGO','BLOCKED','READY_REVIEW','DONE','MONITORING','DISCARDED')),
  "sourceStatus" text NOT NULL CHECK ("sourceStatus" IN ('ACTIVE','IDLE','NOT_LOADED','ARCHIVED','UNKNOWN')),
  "actorRef" text NOT NULL CHECK (length("actorRef") BETWEEN 1 AND 160),
  "observedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("taskId", fingerprint, "humanStatus")
);
CREATE INDEX "CompanyOsCodexTaskObservation_observed_idx"
  ON public."CompanyOsCodexTaskObservation" ("observedAt" DESC);

CREATE TABLE public."CompanyOsCodexInventorySync" (
  id text PRIMARY KEY,
  "sourceHost" text NOT NULL CHECK (length("sourceHost") BETWEEN 1 AND 120),
  "scanId" text NOT NULL CHECK (length("scanId") BETWEEN 8 AND 160),
  "observedCount" integer NOT NULL DEFAULT 0 CHECK ("observedCount" >= 0),
  "changedCount" integer NOT NULL DEFAULT 0 CHECK ("changedCount" >= 0),
  "completedAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "CompanyOsCodexInventorySync_host_completed_idx"
  ON public."CompanyOsCodexInventorySync" ("sourceHost", "completedAt" DESC);

ALTER TABLE public."CompanyOsCodexTask" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CompanyOsCodexTaskObservation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CompanyOsCodexInventorySync" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CompanyOsCodexTask" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."CompanyOsCodexTaskObservation" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."CompanyOsCodexInventorySync" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."CompanyOsCodexTask" FROM PUBLIC, anon, authenticated, service_role, company_os_reader;
REVOKE ALL ON TABLE public."CompanyOsCodexTaskObservation" FROM PUBLIC, anon, authenticated, service_role, company_os_reader;
REVOKE ALL ON TABLE public."CompanyOsCodexInventorySync" FROM PUBLIC, anon, authenticated, service_role, company_os_reader;
GRANT SELECT, INSERT, UPDATE ON TABLE public."CompanyOsCodexTask" TO company_os_v3;
GRANT SELECT, INSERT ON TABLE public."CompanyOsCodexTaskObservation" TO company_os_v3;
GRANT SELECT, INSERT ON TABLE public."CompanyOsCodexInventorySync" TO company_os_v3;

CREATE POLICY company_os_codex_task_select ON public."CompanyOsCodexTask" FOR SELECT TO company_os_v3 USING (true);
CREATE POLICY company_os_codex_task_insert ON public."CompanyOsCodexTask" FOR INSERT TO company_os_v3 WITH CHECK (true);
CREATE POLICY company_os_codex_task_update ON public."CompanyOsCodexTask" FOR UPDATE TO company_os_v3 USING (true) WITH CHECK (true);
CREATE POLICY company_os_codex_observation_select ON public."CompanyOsCodexTaskObservation" FOR SELECT TO company_os_v3 USING (true);
CREATE POLICY company_os_codex_observation_insert ON public."CompanyOsCodexTaskObservation" FOR INSERT TO company_os_v3 WITH CHECK (true);
CREATE POLICY company_os_codex_sync_select ON public."CompanyOsCodexInventorySync" FOR SELECT TO company_os_v3 USING (true);
CREATE POLICY company_os_codex_sync_insert ON public."CompanyOsCodexInventorySync" FOR INSERT TO company_os_v3 WITH CHECK (true);

CREATE TRIGGER company_os_codex_observation_append_only
BEFORE UPDATE OR DELETE ON public."CompanyOsCodexTaskObservation"
FOR EACH ROW EXECUTE FUNCTION public.company_os_v3_reject_mutation();
CREATE TRIGGER company_os_codex_sync_append_only
BEFORE UPDATE OR DELETE ON public."CompanyOsCodexInventorySync"
FOR EACH ROW EXECUTE FUNCTION public.company_os_v3_reject_mutation();

COMMIT;
