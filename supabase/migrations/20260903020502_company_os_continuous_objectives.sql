-- Continuous objectives organize the existing V3 runtime. No business DML or new worker.
CREATE TABLE public."CompanyOsContinuousObjective" (
  id text PRIMARY KEY,
  version integer NOT NULL DEFAULT 1 CHECK (version = 1),
  "controlRevision" integer NOT NULL DEFAULT 0 CHECK ("controlRevision" >= 0),
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 160),
  objective text NOT NULL CHECK (char_length(objective) BETWEEN 10 AND 4000),
  status text NOT NULL CHECK (status IN ('ACTIVE','PAUSED','EXPIRED')),
  "startsAt" timestamptz NOT NULL,
  "endsAt" timestamptz NOT NULL,
  "projectAllowlist" jsonb NOT NULL CHECK (jsonb_typeof("projectAllowlist") = 'array' AND jsonb_array_length("projectAllowlist") BETWEEN 1 AND 20),
  criteria jsonb NOT NULL CHECK (jsonb_typeof(criteria) = 'array' AND jsonb_array_length(criteria) BETWEEN 1 AND 12),
  "scanIntervalMinutes" integer NOT NULL DEFAULT 15 CHECK ("scanIntervalMinutes" BETWEEN 15 AND 1440),
  "nextScanAt" timestamptz NOT NULL,
  "scanCursor" text NOT NULL DEFAULT '',
  "scanObserved" integer NOT NULL DEFAULT 0 CHECK ("scanObserved" >= 0),
  "scanExcluded" integer NOT NULL DEFAULT 0 CHECK ("scanExcluded" >= 0),
  "scanDomains" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "sourcesObserved" integer NOT NULL DEFAULT 0,
  "sourcesExcluded" integer NOT NULL DEFAULT 0,
  "lastScanAt" timestamptz,
  "createdBy" text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CHECK ("projectAllowlist" <@ '["AGENTE MANAGER","SISTEMA ESWCARGO","AGENT OS","ESWCARGO","CRM ESWTECH","CRM ESWTECH · WHATSAPP OPERATIVO","LISTAS Y DIFUSION PRECIOS","GOOGLE ADS ESWTECH","PLANILLAS SHEETS MANEJO","COMPRAS ESW","COTIZADOR ENVIOS ESWTECH"]'::jsonb),
  CHECK ("endsAt" > "startsAt" AND "endsAt" <= "startsAt" + interval '30 days')
);
CREATE INDEX company_os_continuous_objective_due ON public."CompanyOsContinuousObjective" (status,"nextScanAt");

CREATE TABLE public."CompanyOsObjectiveUnit" (
  id text PRIMARY KEY,
  "goalId" text NOT NULL REFERENCES public."CompanyOsContinuousObjective"(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version = 1),
  "sourceId" text NOT NULL,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  "caseId" text UNIQUE REFERENCES public."CompanyOsCase"(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('PLANNED','QUEUED','ANALYZED','VERIFIED','NEEDS_REVIEW','BLOCKED','SKIPPED')),
  "ownerAgentId" text NOT NULL CHECK ("ownerAgentId" IN ('general-manager-ai-v3','systems-manager-ai-v1','data-manager-ai-v1')),
  priority integer NOT NULL CHECK (priority BETWEEN 0 AND 5),
  source jsonb NOT NULL CHECK (jsonb_typeof(source) = 'object'),
  "resultSummary" text,
  "resultEvidence" jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof("resultEvidence") = 'array'),
  "sourceResolved" boolean NOT NULL DEFAULT false CHECK ("sourceResolved" = false),
  "verificationScope" text NOT NULL DEFAULT 'ANALYSIS_ONLY' CHECK ("verificationScope" = 'ANALYSIS_ONLY'),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("goalId",version,"sourceId",fingerprint),
  UNIQUE (id,"goalId"),
  CHECK (status NOT IN ('QUEUED','ANALYZED','VERIFIED') OR "caseId" IS NOT NULL),
  CHECK (status <> 'VERIFIED' OR jsonb_array_length("resultEvidence") > 1)
);
CREATE UNIQUE INDEX company_os_objective_one_queued ON public."CompanyOsObjectiveUnit" ("goalId") WHERE status = 'QUEUED';
CREATE INDEX company_os_objective_unit_pending ON public."CompanyOsObjectiveUnit" ("goalId",status,priority,"createdAt");

CREATE TABLE public."CompanyOsObjectiveEvent" (
  id text PRIMARY KEY,
  "goalId" text NOT NULL REFERENCES public."CompanyOsContinuousObjective"(id) ON DELETE RESTRICT,
  "unitId" text,
  "eventType" text NOT NULL,
  "actorRef" text NOT NULL,
  "idempotencyKey" text NOT NULL UNIQUE,
  "requestHash" text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY ("unitId","goalId") REFERENCES public."CompanyOsObjectiveUnit"(id,"goalId") ON DELETE RESTRICT
);
CREATE INDEX company_os_objective_event_history ON public."CompanyOsObjectiveEvent" ("goalId","createdAt");
CREATE TRIGGER company_os_objective_event_append_only BEFORE UPDATE OR DELETE ON public."CompanyOsObjectiveEvent"
  FOR EACH ROW EXECUTE FUNCTION public.company_os_v3_reject_mutation();

CREATE FUNCTION public.company_os_continuous_objective_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Continuous objective history cannot be deleted'; END IF;
  IF TG_TABLE_NAME = 'CompanyOsContinuousObjective' THEN
    IF (to_jsonb(NEW) - ARRAY['status','controlRevision','nextScanAt','scanCursor','scanObserved','scanExcluded','scanDomains','sourcesObserved','sourcesExcluded','lastScanAt','updatedAt'])
      IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','controlRevision','nextScanAt','scanCursor','scanObserved','scanExcluded','scanDomains','sourcesObserved','sourcesExcluded','lastScanAt','updatedAt']) THEN
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
      (OLD.status IN ('BLOCKED','NEEDS_REVIEW') AND NEW.status IN ('ANALYZED','VERIFIED','NEEDS_REVIEW','BLOCKED','SKIPPED'))
    ) THEN RAISE EXCEPTION 'Invalid objective unit transition'; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.company_os_continuous_objective_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER company_os_continuous_objective_guard BEFORE UPDATE OR DELETE ON public."CompanyOsContinuousObjective"
  FOR EACH ROW EXECUTE FUNCTION public.company_os_continuous_objective_guard();
CREATE TRIGGER company_os_continuous_unit_guard BEFORE UPDATE OR DELETE ON public."CompanyOsObjectiveUnit"
  FOR EACH ROW EXECUTE FUNCTION public.company_os_continuous_objective_guard();

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['CompanyOsContinuousObjective','CompanyOsObjectiveUnit','CompanyOsObjectiveEvent'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated,service_role,company_os_reader', table_name);
    EXECUTE format('GRANT SELECT,INSERT ON TABLE public.%I TO company_os_v3', table_name);
    EXECUTE format('CREATE POLICY objective_select ON public.%I FOR SELECT TO company_os_v3 USING (true)', table_name);
    EXECUTE format('CREATE POLICY objective_insert ON public.%I FOR INSERT TO company_os_v3 WITH CHECK (true)', table_name);
    IF table_name <> 'CompanyOsObjectiveEvent' THEN
      EXECUTE format('GRANT UPDATE ON TABLE public.%I TO company_os_v3', table_name);
      EXECUTE format('CREATE POLICY objective_update ON public.%I FOR UPDATE TO company_os_v3 USING (true) WITH CHECK (true)', table_name);
    END IF;
  END LOOP;
END $$;
