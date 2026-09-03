-- Installs the Data Manager as a local-only, advisory Runtime 24/7 handler.
-- The worker routes this identity to Ollama on DiegoServer; no business data
-- is sent to OpenAI by the Data Manager path.
BEGIN;

DO $company_os_data_contract_migration$
DECLARE
  data_manager_contract CONSTANT jsonb := $company_os_data_manager_contract$
{"agentId":"data-manager-ai-v1","name":"Gerente de Datos AI","version":"1.0.0","reportsToAgentId":"general-manager-ai-v3","domain":"DATA_QUALITY_FRESHNESS_AND_COVERAGE","acceptedTriggers":["MANUAL","SCHEDULE","EVENT","AGENT_MESSAGE"],"requiredSources":["CompanyOsCase.objective","CompanyOsEvidenceRef.payload","CompanyOsMessage.context","server-materialized-business-snapshot","CompanyOsAgentSchedule"],"allowedTools":["ollama.chat.structured-output","company-os.evidence.read","company-os.data-quality.snapshot.read","company-os.mission.append"],"allowedInternalTables":["CompanyOsCase","CompanyOsEvidenceRef","CompanyOsMessage","CompanyOsCaseEvent","CompanyOsAuditEvent","CompanyOsMission","CompanyOsDecision","CompanyOsExecutionAttempt","CompanyOsLease","CompanyOsLock","CompanyOsUsage","CompanyOsAgentSchedule","CompanyOsHeartbeat","CompanyOsWorkerHeartbeat","CompanyOsNotificationDelivery","CompanyOsWorkItem"],"prohibitedTables":["Client","Product","Supplier","Order","OrderItem","Transaction","Shipment","Purchase","PurchaseItem","PurchaseAllocation","Expense","SupplierOffer","SupplierPriceListLoad","IngestionRun","IngestionItem"],"prohibitedActions":["PAYMENT","TRANSFER","PURCHASE","PRICE_CHANGE","INVENTORY_CHANGE","ORDER_CHANGE","CUSTOMER_CHANGE","SHIPMENT_CHANGE","EXPENSE_CHANGE","EXTERNAL_MESSAGE","DEPLOY","MERGE","INFRASTRUCTURE_CHANGE","ROLLBACK","AWS_USE","SECRET_ROTATION","SECRET_READ_OR_DISCLOSURE"],"timeoutMs":120000,"concurrency":1,"budgets":{"dailyTokens":48000,"monthlyTokens":1000000,"maxOutputTokens":3000,"targetTotalTokensPerAttempt":12000},"lowConfidencePolicy":{"minConfidence":0.75,"action":"ABSTAIN_AND_ESCALATE","caseStatus":"NEEDS_REVIEW","escalationTarget":"general-manager-ai-v3","createReviewMessage":true},"inputSchemaVersion":1,"outputSchemaVersion":1,"inputSchema":{"type":"object","additionalProperties":false,"required":["requestId","caseId","leaseToken","agentId","objective","evidencePayload","budgets"],"properties":{"requestId":{"type":"string","minLength":1},"caseId":{"type":"string","minLength":1},"leaseToken":{"type":"string","minLength":1},"objective":{"type":"string","minLength":1},"evidencePayload":{},"contextMessages":{"type":"array","items":{"type":"object"}},"budgets":{"type":"object","additionalProperties":false,"required":["maxOutputTokens","targetTotalTokens"],"properties":{"maxOutputTokens":{"type":"integer","minimum":1},"targetTotalTokens":{"type":"integer","minimum":1}}},"agentId":{"const":"data-manager-ai-v1"}}},"outputSchema":{"type":"object","additionalProperties":false,"required":["summary","primaryDataQualityProblem","primaryFreshnessGap","recommendedNextStep","evidenceRefs","dataFindings","missions","needsHumanDecision","confidence"],"properties":{"summary":{"type":"string","minLength":1},"primaryDataQualityProblem":{"type":"string","minLength":1},"primaryFreshnessGap":{"type":"string","minLength":1},"recommendedNextStep":{"type":"string","minLength":1},"evidenceRefs":{"type":"array","items":{"type":"string","minLength":1}},"dataFindings":{"type":"array","maxItems":10,"items":{"type":"object","additionalProperties":false,"required":["findingId","title","classification","priority","evidenceRefs"],"properties":{"findingId":{"type":"string","minLength":1},"title":{"type":"string","minLength":1},"classification":{"type":"string","enum":["ACTION_REQUIRED","REVIEW","INFO"]},"priority":{"type":"integer","minimum":0,"maximum":100},"evidenceRefs":{"type":"array","items":{"type":"string","minLength":1}}}}},"missions":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["title","objective","evidenceRefs","status"],"properties":{"title":{"type":"string"},"objective":{"type":"string","minLength":1},"evidenceRefs":{"type":"array","items":{"type":"string","minLength":1}},"status":{"type":"string","enum":["PLANNED"]}}}},"needsHumanDecision":{"type":"boolean"},"confidence":{"type":"number","minimum":0,"maximum":1}}},"escalationRules":["Escalate datos ausentes, obsoletos, contradictorios o con cobertura desconocida al Gerente General.","Escalate antes de corregir, borrar, importar o mutar cualquier dato empresarial.","No infieras stock, precios, costos, clientes o proveedores cuando la evidencia no esté materializada."],"handlerKey":"data-manager-advisory","advisoryOnly":true,"timeZone":"America/New_York","scheduleObjective":"Actualizá determinísticamente la calidad, frescura, consistencia y cobertura de las fuentes observables. No modifiques datos empresariales ni ejecutes compras."}
$company_os_data_manager_contract$::jsonb;
BEGIN
  INSERT INTO public."CompanyOsAgentContract"
    (id, "agentId", "contractVersion", name, "reportsToAgentId", domain, "handlerKey", status, contract)
  VALUES (
    'agent-contract:data-manager-ai-v1:1.0.0',
    data_manager_contract->>'agentId',
    data_manager_contract->>'version',
    data_manager_contract->>'name',
    data_manager_contract->>'reportsToAgentId',
    data_manager_contract->>'domain',
    data_manager_contract->>'handlerKey',
    'INSTALLED',
    data_manager_contract
  )
  ON CONFLICT ("agentId", "contractVersion") DO NOTHING;

  IF NOT EXISTS (
    SELECT 1 FROM public."CompanyOsAgentContract"
    WHERE id = 'agent-contract:data-manager-ai-v1:1.0.0'
      AND "agentId" = data_manager_contract->>'agentId'
      AND "contractVersion" = data_manager_contract->>'version'
      AND name = data_manager_contract->>'name'
      AND "reportsToAgentId" IS NOT DISTINCT FROM data_manager_contract->>'reportsToAgentId'
      AND domain = data_manager_contract->>'domain'
      AND "handlerKey" = data_manager_contract->>'handlerKey'
      AND status = 'INSTALLED'
      AND contract = data_manager_contract
  ) THEN
    RAISE EXCEPTION 'Company OS Data Manager contract 1.0.0 is not canonical';
  END IF;
END;
$company_os_data_contract_migration$;

INSERT INTO public."CompanyOsAgentSchedule" (
  id, "agentId", "scheduleKey", revision, cadence, "localTime", "timeZone", "dayOfWeek",
  enabled, "caseType", scope, configuration, "nextRunAt", "lastRunAt", "idempotencyKey"
) VALUES (
  'schedule_data_manager_daily_v1', 'data-manager-ai-v1', 'daily-quality-baseline', 1,
  'DAILY', time '08:15:00', 'America/New_York', NULL, true,
  'DATA_QUALITY_BASELINE', 'BASELINE', '{"maxOutputTokens":3000,"targetTotalTokens":12000}'::jsonb,
  now(),
  NULL,
  'data-manager-ai-v1:daily-quality-baseline:v1'
)
ON CONFLICT ("idempotencyKey") DO NOTHING;

COMMENT ON TABLE public."CompanyOsAgentContract" IS 'Versioned Company OS advisory handlers; Data Manager v1 is local-only on DiegoServer.';

COMMIT;
