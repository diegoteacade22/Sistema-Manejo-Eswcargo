-- General Manager 3.1.2: append-only contract revision that can delegate to
-- the installed Data Manager while retaining the 3.1.1 audit record.
BEGIN;

DO $company_os_general_contract_migration$
DECLARE
  general_manager_contract CONSTANT jsonb := $company_os_general_manager_contract$
{"agentId":"general-manager-ai-v3","name":"Gerente General AI","version":"3.1.2","reportsToAgentId":null,"domain":"GENERAL_MANAGEMENT","acceptedTriggers":["MANUAL","EVENT","AGENT_MESSAGE"],"requiredSources":["CompanyOsCase.objective","CompanyOsEvidenceRef.payload","CompanyOsMessage.context","server-materialized-business-snapshot"],"allowedTools":["openai.responses.structured-output","company-os.evidence.read","company-os.mission.append"],"allowedInternalTables":["CompanyOsCase","CompanyOsEvidenceRef","CompanyOsMessage","CompanyOsCaseEvent","CompanyOsAuditEvent","CompanyOsMission","CompanyOsDecision","CompanyOsExecutionAttempt","CompanyOsLease","CompanyOsLock","CompanyOsUsage","CompanyOsAgentSchedule","CompanyOsHeartbeat","CompanyOsWorkerHeartbeat","CompanyOsNotificationDelivery","CompanyOsWorkItem"],"prohibitedTables":["Client","Product","Supplier","Order","OrderItem","Transaction","Shipment","Purchase","PurchaseItem","PurchaseAllocation","Expense","SupplierOffer","SupplierPriceListLoad","IngestionRun","IngestionItem"],"prohibitedActions":["PAYMENT","TRANSFER","PURCHASE","PRICE_CHANGE","INVENTORY_CHANGE","ORDER_CHANGE","CUSTOMER_CHANGE","SHIPMENT_CHANGE","EXPENSE_CHANGE","EXTERNAL_MESSAGE","DEPLOY","MERGE","INFRASTRUCTURE_CHANGE","ROLLBACK","AWS_USE","SECRET_ROTATION","SECRET_READ_OR_DISCLOSURE"],"timeoutMs":120000,"concurrency":1,"budgets":{"dailyTokens":48000,"monthlyTokens":1000000,"maxOutputTokens":3000,"targetTotalTokensPerAttempt":12000},"lowConfidencePolicy":{"minConfidence":0.75,"action":"ABSTAIN_AND_ESCALATE","caseStatus":"NEEDS_REVIEW","escalationTarget":"diego-ceo","createReviewMessage":true},"inputSchemaVersion":1,"outputSchemaVersion":2,"inputSchema":{"type":"object","additionalProperties":false,"required":["requestId","caseId","leaseToken","agentId","objective","evidencePayload","budgets"],"properties":{"requestId":{"type":"string","minLength":1},"caseId":{"type":"string","minLength":1},"leaseToken":{"type":"string","minLength":1},"objective":{"type":"string","minLength":1},"evidencePayload":{},"contextMessages":{"type":"array","items":{"type":"object"}},"budgets":{"type":"object","additionalProperties":false,"required":["maxOutputTokens","targetTotalTokens"],"properties":{"maxOutputTokens":{"type":"integer","minimum":1},"targetTotalTokens":{"type":"integer","minimum":1}}},"agentId":{"const":"general-manager-ai-v3"}}},"outputSchema":{"type":"object","additionalProperties":false,"required":["summary","primaryDataQualityProblem","evidenceRefs","recommendedNextStep","missions","delegations","needsHumanDecision","confidence"],"properties":{"summary":{"type":"string","minLength":1},"primaryDataQualityProblem":{"type":"string","minLength":1},"evidenceRefs":{"type":"array","items":{"type":"string","minLength":1}},"recommendedNextStep":{"type":"string","minLength":1},"missions":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["title","objective","evidenceRefs","status"],"properties":{"title":{"type":"string"},"objective":{"type":"string","minLength":1},"evidenceRefs":{"type":"array","items":{"type":"string","minLength":1}},"status":{"type":"string","enum":["PLANNED"]}}}},"delegations":{"type":"array","maxItems":1,"items":{"type":"object","additionalProperties":false,"required":["agentId","objective","evidenceRefs"],"properties":{"agentId":{"type":"string","enum":["systems-manager-ai-v1","data-manager-ai-v1"]},"objective":{"type":"string","minLength":1},"evidenceRefs":{"type":"array","items":{"type":"string","minLength":1}}}}},"needsHumanDecision":{"type":"boolean"},"confidence":{"type":"number","minimum":0,"maximum":1}}},"escalationRules":["Escalate to Diego when confidence is below threshold.","Escalate before any business-side mutation or external communication.","Escalate conflicting or insufficient evidence; never infer missing facts."],"handlerKey":"general-manager-advisory","advisoryOnly":true,"timeZone":"America/New_York"}
$company_os_general_manager_contract$::jsonb;
BEGIN
  INSERT INTO public."CompanyOsAgentContract"
    (id, "agentId", "contractVersion", name, "reportsToAgentId", domain, "handlerKey", status, contract)
  VALUES (
    'agent-contract:general-manager-ai-v3:3.1.2',
    general_manager_contract->>'agentId',
    general_manager_contract->>'version',
    general_manager_contract->>'name',
    general_manager_contract->>'reportsToAgentId',
    general_manager_contract->>'domain',
    general_manager_contract->>'handlerKey',
    'INSTALLED',
    general_manager_contract
  )
  ON CONFLICT ("agentId", "contractVersion") DO NOTHING;

  IF NOT EXISTS (
    SELECT 1 FROM public."CompanyOsAgentContract"
    WHERE id = 'agent-contract:general-manager-ai-v3:3.1.2'
      AND "agentId" = general_manager_contract->>'agentId'
      AND "contractVersion" = general_manager_contract->>'version'
      AND name = general_manager_contract->>'name'
      AND "reportsToAgentId" IS NOT DISTINCT FROM general_manager_contract->>'reportsToAgentId'
      AND domain = general_manager_contract->>'domain'
      AND "handlerKey" = general_manager_contract->>'handlerKey'
      AND status = 'INSTALLED'
      AND contract = general_manager_contract
  ) THEN
    RAISE EXCEPTION 'Company OS General Manager contract 3.1.2 is not canonical';
  END IF;
END;
$company_os_general_contract_migration$;

COMMIT;
