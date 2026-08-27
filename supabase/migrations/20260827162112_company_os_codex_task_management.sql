-- Human task management for the Company OS work center.
-- Board state is separate from collector-owned task evidence, so future scans
-- cannot overwrite human workflow decisions. Actions are append-only.
BEGIN;

CREATE TABLE public."CompanyOsCodexTaskBoardState" (
  "taskId" text PRIMARY KEY REFERENCES public."CompanyOsCodexTask"(id) ON DELETE RESTRICT,
  "workflowStatus" text NOT NULL CHECK ("workflowStatus" IN ('UNREVIEWED','PENDING','IN_PROGRESS','NEEDS_DIEGO','BLOCKED','READY_REVIEW','DONE','MONITORING','DISCARDED')),
  lifecycle text NOT NULL DEFAULT 'OPEN' CHECK (lifecycle IN ('OPEN','CLOSED','ARCHIVED')),
  "previousLifecycle" text CHECK ("previousLifecycle" IS NULL OR "previousLifecycle" IN ('OPEN','CLOSED','ARCHIVED')),
  "sourceFingerprint" text NOT NULL CHECK ("sourceFingerprint" ~ '^[0-9a-f]{64}$'),
  "projectNameOverride" text CHECK ("projectNameOverride" IS NULL OR length("projectNameOverride") BETWEEN 1 AND 160),
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
  action text NOT NULL CHECK (action IN ('MOVE','MOVE_PROJECT','ARCHIVE','CLOSE','REOPEN')),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  "requestHash" text NOT NULL CHECK ("requestHash" ~ '^[0-9a-f]{64}$'),
  "previousVersion" integer NOT NULL CHECK ("previousVersion" >= 0),
  "newVersion" integer NOT NULL CHECK ("newVersion" = "previousVersion" + 1),
  "previousHumanStatus" text NOT NULL CHECK ("previousHumanStatus" IN ('UNREVIEWED','PENDING','IN_PROGRESS','NEEDS_DIEGO','BLOCKED','READY_REVIEW','DONE','MONITORING','DISCARDED')),
  "newHumanStatus" text NOT NULL CHECK ("newHumanStatus" IN ('UNREVIEWED','PENDING','IN_PROGRESS','NEEDS_DIEGO','BLOCKED','READY_REVIEW','DONE','MONITORING','DISCARDED')),
  "previousLifecycle" text NOT NULL CHECK ("previousLifecycle" IN ('OPEN','CLOSED','ARCHIVED')),
  "newLifecycle" text NOT NULL CHECK ("newLifecycle" IN ('OPEN','CLOSED','ARCHIVED')),
  "previousProjectName" text NOT NULL CHECK (length("previousProjectName") BETWEEN 1 AND 160),
  "newProjectName" text NOT NULL CHECK (length("newProjectName") BETWEEN 1 AND 160),
  "resultSnapshot" jsonb NOT NULL CHECK (jsonb_typeof("resultSnapshot") = 'object'),
  "actorRef" text NOT NULL CHECK (length("actorRef") BETWEEN 1 AND 160),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("taskId", "newVersion")
);

CREATE INDEX "CompanyOsCodexTaskAction_task_created_idx"
  ON public."CompanyOsCodexTaskAction" ("taskId", "createdAt" DESC);

CREATE FUNCTION public.company_os_codex_task_board_require_action()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  prior_version integer;
  prior_human_status text;
  prior_lifecycle text;
  prior_project text;
  effective_project text;
  source_human_status text;
  source_fingerprint text;
  source_archived boolean;
  source_project text;
  expected_result jsonb;
BEGIN
  SELECT task."humanStatus", task.fingerprint, task.archived, task."projectName"
    INTO source_human_status, source_fingerprint, source_archived, source_project
    FROM public."CompanyOsCodexTask" AS task
   WHERE task.id = NEW."taskId";

  IF source_fingerprint IS NULL OR NEW."sourceFingerprint" <> source_fingerprint THEN
    RAISE EXCEPTION 'Codex board transition requires the current source fingerprint';
  END IF;

  IF TG_OP = 'INSERT' THEN
    prior_version := 0;
    prior_human_status := source_human_status;
    prior_lifecycle := CASE WHEN source_archived THEN 'ARCHIVED' WHEN source_human_status IN ('DONE','DISCARDED') THEN 'CLOSED' ELSE 'OPEN' END;
    prior_project := source_project;
  ELSE
    prior_version := OLD.version;
    prior_project := COALESCE(OLD."projectNameOverride", source_project);
    IF OLD.lifecycle <> 'ARCHIVED' AND OLD."sourceFingerprint" <> source_fingerprint THEN
      prior_human_status := source_human_status;
      prior_lifecycle := CASE WHEN source_archived THEN 'ARCHIVED' WHEN source_human_status IN ('DONE','DISCARDED') THEN 'CLOSED' ELSE 'OPEN' END;
    ELSE
      prior_human_status := OLD."workflowStatus";
      prior_lifecycle := OLD.lifecycle;
    END IF;
  END IF;

  effective_project := COALESCE(NEW."projectNameOverride", source_project);
  expected_result := jsonb_build_object(
    'threadId', substring(NEW."taskId" from 12),
    'humanStatus', NEW."workflowStatus",
    'lifecycle', NEW.lifecycle,
    'projectName', effective_project,
    'boardVersion', NEW.version
  );

  IF NOT EXISTS (
    SELECT 1
      FROM public."CompanyOsCodexTaskAction" AS action
     WHERE action."taskId" = NEW."taskId"
       AND action."previousVersion" = prior_version
       AND action."newVersion" = NEW.version
       AND action."previousHumanStatus" = prior_human_status
       AND action."previousLifecycle" = prior_lifecycle
       AND action."previousProjectName" = prior_project
       AND action."newHumanStatus" = NEW."workflowStatus"
       AND action."newLifecycle" = NEW.lifecycle
       AND action."newProjectName" = effective_project
       AND action.fingerprint = source_fingerprint
       AND action."resultSnapshot" = expected_result
       AND action."actorRef" = NEW."updatedBy"
  ) THEN
    RAISE EXCEPTION 'Codex board transition requires its append-only action';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER company_os_codex_task_board_guard
BEFORE INSERT OR UPDATE ON public."CompanyOsCodexTaskBoardState"
FOR EACH ROW EXECUTE FUNCTION public.company_os_codex_task_board_require_action();

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
