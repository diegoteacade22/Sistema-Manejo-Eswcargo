-- Durable read-only intake for external source candidates. Items feed the
-- existing continuous-objective plane and shared V3 queue; no second worker or
-- business-side write path is introduced.
BEGIN;

CREATE TABLE public."CompanyOsExternalSourceItem" (
  id text PRIMARY KEY,
  "sourceId" text NOT NULL CHECK ("sourceId" IN ('GOOGLE_DRIVE','GOOGLE_SHEETS','GOOGLE_CONTACTS','CHATGPT_WORK')),
  "itemKey" text NOT NULL CHECK ("itemKey" ~ '^[a-f0-9]{64}$'),
  "providerRevisionHash" text NOT NULL CHECK ("providerRevisionHash" ~ '^[a-f0-9]{64}$'),
  "revisionFingerprint" text NOT NULL CHECK ("revisionFingerprint" ~ '^[a-f0-9]{64}$'),
  "itemKind" text NOT NULL CHECK ("itemKind" IN ('FILE_METADATA','SHEET_METADATA','CONTACT_METADATA','THREAD_REQUEST')),
  "changeKind" text NOT NULL CHECK ("changeKind" IN ('CREATED','UPDATED','PENDING_REVIEW')),
  "authorityMode" text NOT NULL CHECK ("authorityMode" IN ('GOOGLE_SERVICE_ACCOUNT_READONLY','GOOGLE_USER_OAUTH_READONLY','GOOGLE_DELEGATED_USER_READONLY','AUTHORIZED_CHATGPT_WORK_EXPORT_V1')),
  "principalRefHash" text NOT NULL CHECK ("principalRefHash" ~ '^[a-f0-9]{64}$'),
  "snapshotId" text NOT NULL CHECK ("snapshotId" ~ '^snapshot:[a-f0-9]{32}$'),
  "snapshotEvidenceHash" text NOT NULL CHECK ("snapshotEvidenceHash" ~ '^[a-f0-9]{64}$'),
  "sourceUpdatedAt" timestamptz,
  "workerId" text NOT NULL REFERENCES public."CompanyOsWorker"("workerId") ON DELETE RESTRICT,
  "firstObservedAt" timestamptz NOT NULL,
  "lastObservedAt" timestamptz NOT NULL,
  "observationCount" integer NOT NULL DEFAULT 1 CHECK ("observationCount" BETWEEN 1 AND 1000000000),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("sourceId","itemKey","revisionFingerprint"),
  CHECK (("sourceId"='GOOGLE_DRIVE' AND "itemKind"='FILE_METADATA'
      AND "authorityMode" IN ('GOOGLE_SERVICE_ACCOUNT_READONLY','GOOGLE_USER_OAUTH_READONLY'))
    OR ("sourceId"='GOOGLE_SHEETS' AND "itemKind"='SHEET_METADATA'
      AND "authorityMode" IN ('GOOGLE_SERVICE_ACCOUNT_READONLY','GOOGLE_USER_OAUTH_READONLY'))
    OR ("sourceId"='GOOGLE_CONTACTS' AND "itemKind"='CONTACT_METADATA'
      AND "authorityMode" IN ('GOOGLE_USER_OAUTH_READONLY','GOOGLE_DELEGATED_USER_READONLY'))
    OR ("sourceId"='CHATGPT_WORK' AND "itemKind"='THREAD_REQUEST'
      AND "authorityMode"='AUTHORIZED_CHATGPT_WORK_EXPORT_V1')),
  CHECK ("lastObservedAt" >= "firstObservedAt")
);

CREATE INDEX company_os_external_source_item_active
  ON public."CompanyOsExternalSourceItem" ("sourceId","lastObservedAt" DESC,"sourceUpdatedAt" DESC,id);
CREATE INDEX company_os_external_source_item_root
  ON public."CompanyOsExternalSourceItem" ("sourceId","itemKey","lastObservedAt" DESC);

CREATE FUNCTION public.company_os_external_source_item_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'External source item history cannot be deleted'; END IF;
  IF (to_jsonb(NEW) - ARRAY['lastObservedAt','observationCount','updatedAt'])
    IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['lastObservedAt','observationCount','updatedAt'])
    OR NEW."lastObservedAt" <= OLD."lastObservedAt"
    OR NEW."observationCount" <> OLD."observationCount" + 1 THEN
    RAISE EXCEPTION 'External source item revision is immutable';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.company_os_external_source_item_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER company_os_external_source_item_guard
  BEFORE UPDATE OR DELETE ON public."CompanyOsExternalSourceItem"
  FOR EACH ROW EXECUTE FUNCTION public.company_os_external_source_item_guard();

ALTER TABLE public."CompanyOsExternalSourceItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CompanyOsExternalSourceItem" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."CompanyOsExternalSourceItem" FROM PUBLIC,anon,authenticated,service_role,company_os_reader;
GRANT SELECT,INSERT ON TABLE public."CompanyOsExternalSourceItem" TO company_os_v3;
GRANT UPDATE ("lastObservedAt","observationCount","updatedAt") ON TABLE public."CompanyOsExternalSourceItem" TO company_os_v3;
CREATE POLICY external_source_item_select ON public."CompanyOsExternalSourceItem"
  FOR SELECT TO company_os_v3 USING (true);
CREATE POLICY external_source_item_insert ON public."CompanyOsExternalSourceItem"
  FOR INSERT TO company_os_v3 WITH CHECK (true);
CREATE POLICY external_source_item_update ON public."CompanyOsExternalSourceItem"
  FOR UPDATE TO company_os_v3 USING (true) WITH CHECK (true);

COMMIT;
