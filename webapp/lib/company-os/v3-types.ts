export const COMPANY_OS_REQUEST_STATUSES = [
  'QUEUED', 'ANALYZING', 'AWAITING_REVIEW', 'BLOCKED', 'FAILED', 'CANCELLED', 'COMPLETED',
] as const;

export type CompanyOsRequestStatus = (typeof COMPANY_OS_REQUEST_STATUSES)[number];

export const COMPANY_OS_MISSION_STATUSES = [
  'PLANNED', 'APPROVED', 'REJECTED', 'REVIEW', 'BLOCKED', 'RUNNING', 'DONE',
] as const;

export type CompanyOsMissionStatus = (typeof COMPANY_OS_MISSION_STATUSES)[number];

export const COMPANY_OS_V3_IDENTITY = 'general-manager-ai-v3' as const;
export const COMPANY_OS_SYSTEMS_MANAGER_IDENTITY = 'systems-manager-ai-v1' as const;
export const COMPANY_OS_DATA_MANAGER_IDENTITY = 'data-manager-ai-v1' as const;
export const COMPANY_OS_AGENT_IDS = [
  COMPANY_OS_V3_IDENTITY,
  COMPANY_OS_SYSTEMS_MANAGER_IDENTITY,
  COMPANY_OS_DATA_MANAGER_IDENTITY,
] as const;
export type CompanyOsAgentId = (typeof COMPANY_OS_AGENT_IDS)[number];

export const COMPANY_OS_AGENT_CONTRACTS: Record<CompanyOsAgentId, {
  displayName: string;
  area: string;
  reportsToAgentId: string | null;
}> = {
  [COMPANY_OS_V3_IDENTITY]: {
    displayName: 'Gerente General AI',
    area: 'GENERAL_MANAGEMENT',
    reportsToAgentId: null,
  },
  [COMPANY_OS_SYSTEMS_MANAGER_IDENTITY]: {
    displayName: 'Gerente de Sistemas AI',
    area: 'SYSTEMS',
    reportsToAgentId: COMPANY_OS_V3_IDENTITY,
  },
  [COMPANY_OS_DATA_MANAGER_IDENTITY]: {
    displayName: 'Gerente de Datos AI',
    area: 'DATA_QUALITY',
    reportsToAgentId: COMPANY_OS_V3_IDENTITY,
  },
};
export const COMPANY_OS_V3_MODEL = 'gpt-5.6-sol' as const;
export const COMPANY_OS_V3_MAX_OUTPUT_TOKENS = 3000;
export const COMPANY_OS_V3_TARGET_TOTAL_TOKENS = 12000;
export const COMPANY_OS_V3_INPUT_BUDGET = COMPANY_OS_V3_TARGET_TOTAL_TOKENS - COMPANY_OS_V3_MAX_OUTPUT_TOKENS;
export const COMPANY_OS_V3_ALERTS = [70, 85, 100] as const;

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function companyOsV3BudgetConfig() {
  const maxOutputTokens = positiveInteger(process.env.COMPANY_OS_V3_MAX_OUTPUT_TOKENS, COMPANY_OS_V3_MAX_OUTPUT_TOKENS);
  const targetTotalTokens = positiveInteger(process.env.COMPANY_OS_V3_TARGET_TOTAL_TOKENS, COMPANY_OS_V3_TARGET_TOTAL_TOKENS);
  if (targetTotalTokens <= maxOutputTokens) throw new Error('Presupuesto V3 inválido');
  const alerts = (process.env.COMPANY_OS_V3_ALERTS ?? '70,85,100').split(',').map(Number).filter((value) => [70, 85, 100].includes(value));
  return { maxOutputTokens, targetTotalTokens, inputBudget: targetTotalTokens - maxOutputTokens, alerts };
}

export function companyOsDailyTokenLimit(agentId: CompanyOsAgentId) {
  const specific = agentId === COMPANY_OS_SYSTEMS_MANAGER_IDENTITY
    ? process.env.COMPANY_OS_SYSTEMS_DAILY_TOKEN_LIMIT
    : process.env.COMPANY_OS_GENERAL_DAILY_TOKEN_LIMIT;
  return positiveInteger(specific ?? process.env.COMPANY_OS_V3_DAILY_TOKEN_LIMIT, 48_000);
}

export type CompanyOsWorkerResult = {
  summary: string;
  primaryDataQualityProblem: string;
  evidenceRefs: string[];
  recommendedNextStep: string;
  missions: Array<{
    title: string;
    objective: string;
    evidenceRefs: string[];
    status: 'PLANNED';
  }>;
};

export type CompanyOsSystemsWorkerResult = {
  summary: string;
  primaryConfirmedRisk: string;
  primaryCoverageGap: string;
  confirmedRiskNextStep: string;
  coverageGapNextStep: string;
  evidenceRefs: string[];
  actionableRisks: Array<{
    riskId: string;
    title: string;
    assetId: string;
    classification: 'ACTION_REQUIRED';
    priority: number;
    evidenceRefs: string[];
  }>;
  missions: Array<{
    title: string;
    objective: string;
    evidenceRefs: string[];
    status: 'PLANNED';
  }>;
};

export type CompanyOsWorkerUsage = {
  provider: 'openai';
  model: string;
  inputTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  responseId?: string | null;
  durationMs?: number;
  retries?: number;
  snapshotBytes?: number;
  rulesApplied?: string[];
};
