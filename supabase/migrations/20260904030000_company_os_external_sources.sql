-- External sources remain read-only and fail closed until an independent runtime
-- connector is installed. Empty Codex scope is valid only with an external source.
ALTER TABLE public."CompanyOsContinuousObjective"
  ADD COLUMN IF NOT EXISTS "externalSources" jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public."CompanyOsContinuousObjective"
  DROP CONSTRAINT IF EXISTS "CompanyOsContinuousObjective_projectAllowlist_check";

ALTER TABLE public."CompanyOsContinuousObjective"
  ADD CONSTRAINT "CompanyOsContinuousObjective_projectAllowlist_check"
  CHECK (jsonb_typeof("projectAllowlist") = 'array'::text
    AND jsonb_array_length("projectAllowlist") BETWEEN 0 AND 20);

ALTER TABLE public."CompanyOsContinuousObjective"
  ADD CONSTRAINT "CompanyOsContinuousObjective_externalSources_check"
  CHECK (jsonb_typeof("externalSources") = 'array'::text
    AND jsonb_array_length("externalSources") BETWEEN 0 AND 4);

ALTER TABLE public."CompanyOsContinuousObjective"
  ADD CONSTRAINT "CompanyOsContinuousObjective_externalSources_allowed_check"
  CHECK ("externalSources" <@ '["GOOGLE_DRIVE","GOOGLE_SHEETS","GOOGLE_CONTACTS","CHATGPT_WORK"]'::jsonb);

ALTER TABLE public."CompanyOsContinuousObjective"
  ADD CONSTRAINT "CompanyOsContinuousObjective_scope_check"
  CHECK (jsonb_array_length("projectAllowlist") > 0 OR jsonb_array_length("externalSources") > 0);

COMMENT ON COLUMN public."CompanyOsContinuousObjective"."externalSources"
  IS 'Requested read-only external sources. Runtime must keep unavailable connectors blocked and auditable.';
