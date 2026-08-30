-- Human replies for Codex tasks: immutable revisions plus a durable single-delivery outbox.
BEGIN;

ALTER TABLE public."CompanyOsCodexTask"
  ADD COLUMN "decisionRequest" text,
  ADD COLUMN "resultSummary" text,
  ADD CONSTRAINT "CompanyOsCodexTask_decisionRequest_length" CHECK ("decisionRequest" IS NULL OR length("decisionRequest") <= 500),
  ADD CONSTRAINT "CompanyOsCodexTask_resultSummary_length" CHECK ("resultSummary" IS NULL OR length("resultSummary") <= 500);

CREATE TABLE public."CompanyOsCodexTaskReplyRevision" (
  id text PRIMARY KEY,
  "taskId" text NOT NULL REFERENCES public."CompanyOsCodexTask"(id) ON DELETE RESTRICT,
  revision integer NOT NULL CHECK (revision >= 1),
  "idempotencyKey" text NOT NULL UNIQUE CHECK (length("idempotencyKey") BETWEEN 16 AND 160),
  "requestHash" text NOT NULL CHECK ("requestHash" ~ '^[0-9a-f]{64}$'),
  "sourceFingerprint" text NOT NULL CHECK ("sourceFingerprint" ~ '^[0-9a-f]{64}$'),
  "responseText" text NOT NULL CHECK (length("responseText") BETWEEN 2 AND 1000),
  "responseHash" text NOT NULL CHECK ("responseHash" ~ '^[0-9a-f]{64}$'),
  "actorRef" text NOT NULL CHECK (length("actorRef") BETWEEN 1 AND 160),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("taskId", revision),
  UNIQUE (id, "taskId")
);

CREATE INDEX "CompanyOsCodexTaskReplyRevision_task_created_idx"
  ON public."CompanyOsCodexTaskReplyRevision" ("taskId", "createdAt" DESC);

CREATE TABLE public."CompanyOsCodexTaskReplyDelivery" (
  id text PRIMARY KEY,
  "taskId" text NOT NULL REFERENCES public."CompanyOsCodexTask"(id) ON DELETE RESTRICT,
  "replyRevisionId" text NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'CONFIRMED' CHECK (state IN ('CONFIRMED','CLAIMED','DELIVERED','FAILED','UNKNOWN_OUTCOME','SUPERSEDED')),
  "claimBinding" text UNIQUE CHECK ("claimBinding" IS NULL OR "claimBinding" ~ '^[0-9a-f]{64}$'),
  "claimedBy" text CHECK ("claimedBy" IS NULL OR length("claimedBy") BETWEEN 1 AND 160),
  "baselineFingerprint" text NOT NULL CHECK ("baselineFingerprint" ~ '^[0-9a-f]{64}$'),
  "baselineLastCompletedAt" timestamptz,
  "confirmedAt" timestamptz NOT NULL DEFAULT now(),
  "claimedAt" timestamptz,
  "completedAt" timestamptz,
  outcome text CHECK (outcome IS NULL OR outcome IN ('SUCCEEDED','FAILED','TIMED_OUT')),
  "evidenceFingerprint" text CHECK ("evidenceFingerprint" IS NULL OR "evidenceFingerprint" ~ '^[0-9a-f]{64}$'),
  "executionMarker" text CHECK ("executionMarker" IS NULL OR "executionMarker" ~ '^run-[A-Za-z0-9_-]{16,64}$'),
  "promptHash" text CHECK ("promptHash" IS NULL OR "promptHash" ~ '^[0-9a-f]{64}$'),
  "observedPromptHash" text CHECK ("observedPromptHash" IS NULL OR "observedPromptHash" ~ '^[0-9a-f]{64}$'),
  "promptObservedAt" timestamptz,
  UNIQUE ("replyRevisionId", "taskId"),
  CHECK ((state IN ('CONFIRMED','SUPERSEDED') AND "claimBinding" IS NULL AND "claimedBy" IS NULL AND "claimedAt" IS NULL)
      OR (state NOT IN ('CONFIRMED','SUPERSEDED') AND "claimBinding" IS NOT NULL AND "claimedBy" IS NOT NULL AND "claimedAt" IS NOT NULL)),
  CHECK ((state IN ('CONFIRMED','CLAIMED','SUPERSEDED') AND "completedAt" IS NULL AND outcome IS NULL)
      OR (state IN ('DELIVERED','FAILED','UNKNOWN_OUTCOME') AND "completedAt" IS NOT NULL AND outcome IS NOT NULL)),
  CHECK (("executionMarker" IS NULL AND "promptHash" IS NULL)
      OR ("executionMarker" IS NOT NULL AND "promptHash" IS NOT NULL)),
  CHECK (("observedPromptHash" IS NULL AND "promptObservedAt" IS NULL)
      OR ("observedPromptHash" IS NOT NULL AND "promptObservedAt" IS NOT NULL AND "observedPromptHash" = "promptHash")),
  CHECK (state NOT IN ('CONFIRMED','CLAIMED','SUPERSEDED')
      OR ("executionMarker" IS NULL AND "promptHash" IS NULL AND "observedPromptHash" IS NULL AND "promptObservedAt" IS NULL)),
  CHECK (state <> 'DELIVERED'
      OR (outcome = 'SUCCEEDED' AND "executionMarker" IS NOT NULL AND "promptHash" IS NOT NULL
          AND "observedPromptHash" = "promptHash" AND "promptObservedAt" IS NOT NULL)),
  FOREIGN KEY ("replyRevisionId", "taskId")
    REFERENCES public."CompanyOsCodexTaskReplyRevision"(id, "taskId") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "CompanyOsCodexTaskReplyDelivery_one_active_per_task"
  ON public."CompanyOsCodexTaskReplyDelivery" ("taskId")
  WHERE state IN ('CONFIRMED','CLAIMED');
CREATE INDEX "CompanyOsCodexTaskReplyDelivery_state_confirmed_idx"
  ON public."CompanyOsCodexTaskReplyDelivery" (state, "confirmedAt");
CREATE INDEX "CompanyOsCodexTaskReplyDelivery_task_confirmed_idx"
  ON public."CompanyOsCodexTaskReplyDelivery" ("taskId", "confirmedAt" DESC);

ALTER TABLE public."CompanyOsCodexTaskReplyRevision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CompanyOsCodexTaskReplyRevision" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."CompanyOsCodexTaskReplyDelivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CompanyOsCodexTaskReplyDelivery" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."CompanyOsCodexTaskReplyRevision" FROM PUBLIC, anon, authenticated, service_role, company_os_reader;
REVOKE ALL ON TABLE public."CompanyOsCodexTaskReplyDelivery" FROM PUBLIC, anon, authenticated, service_role, company_os_reader;
GRANT SELECT, INSERT ON TABLE public."CompanyOsCodexTaskReplyRevision" TO company_os_v3;
GRANT SELECT, INSERT, UPDATE ON TABLE public."CompanyOsCodexTaskReplyDelivery" TO company_os_v3;
CREATE POLICY company_os_codex_task_reply_revision_select ON public."CompanyOsCodexTaskReplyRevision" FOR SELECT TO company_os_v3 USING (true);
CREATE POLICY company_os_codex_task_reply_revision_insert ON public."CompanyOsCodexTaskReplyRevision" FOR INSERT TO company_os_v3 WITH CHECK (true);
CREATE POLICY company_os_codex_task_reply_delivery_select ON public."CompanyOsCodexTaskReplyDelivery" FOR SELECT TO company_os_v3 USING (true);
CREATE POLICY company_os_codex_task_reply_delivery_insert ON public."CompanyOsCodexTaskReplyDelivery" FOR INSERT TO company_os_v3 WITH CHECK (true);
CREATE POLICY company_os_codex_task_reply_delivery_update ON public."CompanyOsCodexTaskReplyDelivery" FOR UPDATE TO company_os_v3 USING (true) WITH CHECK (true);

CREATE TRIGGER company_os_codex_task_reply_revision_append_only
BEFORE UPDATE OR DELETE ON public."CompanyOsCodexTaskReplyRevision"
FOR EACH ROW EXECUTE FUNCTION public.company_os_v3_reject_mutation();

CREATE FUNCTION public.company_os_codex_task_reply_delivery_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'CompanyOsCodexTaskReplyDelivery is append-only';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW."taskId" IS DISTINCT FROM OLD."taskId"
     OR NEW."replyRevisionId" IS DISTINCT FROM OLD."replyRevisionId"
     OR NEW."baselineFingerprint" IS DISTINCT FROM OLD."baselineFingerprint"
     OR NEW."baselineLastCompletedAt" IS DISTINCT FROM OLD."baselineLastCompletedAt"
     OR NEW."confirmedAt" IS DISTINCT FROM OLD."confirmedAt" THEN
    RAISE EXCEPTION 'CompanyOsCodexTaskReplyDelivery identity and baseline are immutable';
  END IF;
  IF OLD.state = 'CLAIMED' AND (
     NEW."claimBinding" IS DISTINCT FROM OLD."claimBinding"
     OR NEW."claimedBy" IS DISTINCT FROM OLD."claimedBy"
     OR NEW."claimedAt" IS DISTINCT FROM OLD."claimedAt"
  ) THEN
    RAISE EXCEPTION 'CompanyOsCodexTaskReplyDelivery claim identity is immutable after claim';
  END IF;
  IF NOT (
    (OLD.state = 'CONFIRMED' AND NEW.state IN ('CLAIMED', 'SUPERSEDED'))
    OR (OLD.state = 'CLAIMED' AND NEW.state IN ('DELIVERED', 'FAILED', 'UNKNOWN_OUTCOME'))
  ) THEN
    RAISE EXCEPTION 'Invalid CompanyOsCodexTaskReplyDelivery transition: % -> %', OLD.state, NEW.state;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER company_os_codex_task_reply_delivery_guard
BEFORE UPDATE OR DELETE ON public."CompanyOsCodexTaskReplyDelivery"
FOR EACH ROW EXECUTE FUNCTION public.company_os_codex_task_reply_delivery_guard();

COMMIT;
