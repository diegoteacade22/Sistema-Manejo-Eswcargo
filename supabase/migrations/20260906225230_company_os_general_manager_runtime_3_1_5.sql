-- Increase only General's daily accounting ceiling after explicit operator authorization.
-- Monthly limit, per-attempt reservation, concurrency and authority remain unchanged.
BEGIN;

INSERT INTO public."CompanyOsAgentContract"
  (id, "agentId", "contractVersion", name, "reportsToAgentId", domain, "handlerKey", status, contract)
SELECT
  'agent-contract:general-manager-ai-v3:3.1.5',
  "agentId",
  '3.1.5',
  name,
  "reportsToAgentId",
  domain,
  "handlerKey",
  status,
  jsonb_set(
    jsonb_set(contract, '{version}', '"3.1.5"'::jsonb, false),
    '{budgets,dailyTokens}', '192000'::jsonb, false
  )
FROM public."CompanyOsAgentContract"
WHERE "agentId" = 'general-manager-ai-v3'
  AND "contractVersion" = '3.1.4'
  AND status = 'INSTALLED'
ON CONFLICT ("agentId", "contractVersion") DO NOTHING;

DO $company_os_general_manager_runtime_3_1_5_readback$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public."CompanyOsAgentContract"
    WHERE id = 'agent-contract:general-manager-ai-v3:3.1.5'
      AND "agentId" = 'general-manager-ai-v3'
      AND "contractVersion" = '3.1.5'
      AND status = 'INSTALLED'
      AND contract->>'version' = '3.1.5'
      AND contract->'budgets'->>'dailyTokens' = '192000'
      AND contract->'budgets'->>'monthlyTokens' = '1000000'
      AND contract->'budgets'->>'targetTotalTokensPerAttempt' = '12000'
      AND contract->>'advisoryOnly' = 'true'
  ) THEN
    RAISE EXCEPTION 'Company OS General Manager runtime contract 3.1.5 readback failed';
  END IF;
END;
$company_os_general_manager_runtime_3_1_5_readback$;

COMMIT;
