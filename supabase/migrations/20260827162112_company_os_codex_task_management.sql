-- Human task management for the Company OS work center.
-- Board state is separate from collector-owned task evidence, so future scans
-- cannot overwrite human workflow decisions. Actions are append-only.
BEGIN;

CREATE TABLE public."CompanyOsCodexTaskBoardState" (
  "taskId" text PRIMARY KEY REFERENCES public."CompanyOsCodexTask"(id) ON DELETE RESTRICT,
  "workflowStatus" text CHECK ("workflowStatus" IS NULL OR "workflowStatus" IN ('UNREVIEWED','PENDING','IN_PROGRESS','NEEDS_DIEGO','BLOCKED','READY_REVIEW','DONE','MONITORING','DISCARDED')),
  lifecycle text NOT NULL DEFAULT 'OPEN' CHECK (lifecycle IN ('OPEN','CLOSED','ARCHIVED')),
  "previousLifecycle" text CHECK ("previousLifecycle" IS NULL OR "previousLifecycle" IN ('OPEN','CLOSED','ARCHIVED')),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  "updatedBy" text NOT NULL CHECK (length("updatedBy") BETWEEN 1 AND 160),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "CompanyOsCodexTaskBoardState_lifecycle_status_updated_idx"
  ON public."CompanyOsCodexTaskBoardState" (lifecycle, "workflowStatus", "updatedAt" DESC);

CREATE TABLE public."CompanyOsCodexTaskAction" (
  id text PRIMARY KEY,
  "taskId" text NOT NULL REFERENCES public."CompanyOsCodexTask"(id) ON DELETE RESTRICT,
  "idempotencyKey" text NOT NULL UNIQUE CHECK (length("idempotencyKey") BETWEEN 16 AND 160),
  action text NOT NULL CHECK (action IN ('MOVE','ARCHIVE','CLOSE','REOPEN')),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  "previousHumanStatus" text NOT NULL CHECK ("previousHumanStatus" IN ('UNREVIEWED','PENDING','IN_PROGRESS','NEEDS_DIEGO','BLOCKED','READY_REVIEW','DONE','MONITORING','DISCARDED')),
  "newHumanStatus" text NOT NULL CHECK ("newHumanStatus" IN ('UNREVIEWED','PENDING','IN_PROGRESS','NEEDS_DIEGO','BLOCKED','READY_REVIEW','DONE','MONITORING','DISCARDED')),
  "previousLifecycle" text NOT NULL CHECK ("previousLifecycle" IN ('OPEN','CLOSED','ARCHIVED')),
  "newLifecycle" text NOT NULL CHECK ("newLifecycle" IN ('OPEN','CLOSED','ARCHIVED')),
  "actorRef" text NOT NULL CHECK (length("actorRef") BETWEEN 1 AND 160),
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "CompanyOsCodexTaskAction_task_created_idx"
  ON public."CompanyOsCodexTaskAction" ("taskId", "createdAt" DESC);

ALTER TABLE public."CompanyOsCodexTaskBoardState" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CompanyOsCodexTaskBoardState" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."CompanyOsCodexTaskAction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CompanyOsCodexTaskAction" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."CompanyOsCodexTaskBoardState" FROM PUBLIC, anon, authenticated, service_role, company_os_reader;
REVOKE ALL ON TABLE public."CompanyOsCodexTaskAction" FROM PUBLIC, anon, authenticated, service_role, company_os_reader;
GRANT SELECT, INSERT, UPDATE ON TABLE public."CompanyOsCodexTaskBoardState" TO company_os_v3;
GRANT SELECT, INSERT ON TABLE public."CompanyOsCodexTaskAction" TO company_os_v3;
CREATE POLICY company_os_codex_task_board_select ON public."CompanyOsCodexTaskBoardState" FOR SELECT TO company_os_v3 USING (true);
CREATE POLICY company_os_codex_task_board_insert ON public."CompanyOsCodexTaskBoardState" FOR INSERT TO company_os_v3 WITH CHECK (true);
CREATE POLICY company_os_codex_task_board_update ON public."CompanyOsCodexTaskBoardState" FOR UPDATE TO company_os_v3 USING (true) WITH CHECK (true);
CREATE POLICY company_os_codex_task_action_select ON public."CompanyOsCodexTaskAction" FOR SELECT TO company_os_v3 USING (true);
CREATE POLICY company_os_codex_task_action_insert ON public."CompanyOsCodexTaskAction" FOR INSERT TO company_os_v3 WITH CHECK (true);

CREATE TRIGGER company_os_codex_task_action_append_only
BEFORE UPDATE OR DELETE ON public."CompanyOsCodexTaskAction"
FOR EACH ROW EXECUTE FUNCTION public.company_os_v3_reject_mutation();

COMMIT;
