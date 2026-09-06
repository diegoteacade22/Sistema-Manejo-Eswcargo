import {
  COMPANY_OS_AGENT_CONTRACTS,
  COMPANY_OS_DATA_MANAGER_IDENTITY,
  COMPANY_OS_SYSTEMS_MANAGER_IDENTITY,
  COMPANY_OS_V3_IDENTITY,
} from './v3-types';
import type {
  CompanyOsDataManagerWorkerResult,
  CompanyOsSystemsWorkerResult,
  CompanyOsWorkerResult,
} from './v3-types';
import {
  SPECIALIST_CAPABILITIES,
  validateSpecialistDelegation,
} from './specialist-routing';

export const COMPANY_OS_RUNTIME_CONTRACT_VERSION = '1.0.0' as const;
export const COMPANY_OS_TIME_ZONE = 'America/New_York' as const;

export const COMPANY_OS_INSTALLED_AGENT_IDS = [
  COMPANY_OS_V3_IDENTITY,
  COMPANY_OS_SYSTEMS_MANAGER_IDENTITY,
  COMPANY_OS_DATA_MANAGER_IDENTITY,
] as const;

export type CompanyOsInstalledAgentId =
  (typeof COMPANY_OS_INSTALLED_AGENT_IDS)[number];

export const COMPANY_OS_RUNTIME_CONTRACT_VERSIONS = {
  [COMPANY_OS_V3_IDENTITY]: '3.1.5',
  [COMPANY_OS_SYSTEMS_MANAGER_IDENTITY]: '1.1.1',
  [COMPANY_OS_DATA_MANAGER_IDENTITY]: '1.0.0',
} as const satisfies Record<CompanyOsInstalledAgentId, string>;

export const COMPANY_OS_TRIGGER_TYPES = [
  'MANUAL',
  'SCHEDULE',
  'EVENT',
  'AGENT_MESSAGE',
  'RECOVERY',
  'INCIDENT',
] as const;

export type CompanyOsTriggerType = (typeof COMPANY_OS_TRIGGER_TYPES)[number];
export type CompanyOsAgentInstallationStatus = 'INSTALLED' | 'NOT_INSTALLED';
export type CompanyOsGeneralManagerRuntimeOutput = CompanyOsWorkerResult & {
  delegations: Array<{
    agentId: CompanyOsInstalledAgentId;
    capability?: (typeof SPECIALIST_CAPABILITIES)[number];
    objective: string;
    evidenceRefs: string[];
    taskStatus?: 'READY' | 'NEEDS_USER' | 'BLOCKED_EXTERNAL';
    depth?: number;
  }>;
  needsHumanDecision: boolean;
  confidence: number;
};

export type CompanyOsSystemsManagerRuntimeOutput = CompanyOsSystemsWorkerResult & {
  needsHumanDecision: boolean;
  confidence: number;
};

export type CompanyOsDataManagerRuntimeOutput = CompanyOsDataManagerWorkerResult & {
  needsHumanDecision: boolean;
  confidence: number;
};

export type CompanyOsRuntimeOutput =
  | CompanyOsGeneralManagerRuntimeOutput
  | CompanyOsSystemsManagerRuntimeOutput
  | CompanyOsDataManagerRuntimeOutput;

export const COMPANY_OS_MANDATORY_PROHIBITED_TABLES = [
  'Client',
  'Product',
  'Supplier',
  'Order',
  'OrderItem',
  'Transaction',
  'Shipment',
  'Purchase',
  'PurchaseItem',
  'PurchaseAllocation',
  'Expense',
  'SupplierOffer',
  'SupplierPriceListLoad',
  'IngestionRun',
  'IngestionItem',
] as const;

export const COMPANY_OS_MANDATORY_PROHIBITED_ACTIONS = [
  'PAYMENT',
  'TRANSFER',
  'PURCHASE',
  'PRICE_CHANGE',
  'INVENTORY_CHANGE',
  'ORDER_CHANGE',
  'CUSTOMER_CHANGE',
  'SHIPMENT_CHANGE',
  'EXPENSE_CHANGE',
  'EXTERNAL_MESSAGE',
  'DEPLOY',
  'MERGE',
  'INFRASTRUCTURE_CHANGE',
  'ROLLBACK',
  'AWS_USE',
  'SECRET_ROTATION',
  'SECRET_READ_OR_DISCLOSURE',
] as const;

export type StrictJsonObjectSchema = Readonly<{
  type: 'object';
  additionalProperties: false;
  required: readonly string[];
  properties: Readonly<Record<string, unknown>>;
}>;

export type CompanyOsRuntimeContract = Readonly<{
  agentId: CompanyOsInstalledAgentId;
  name: string;
  version: string;
  reportsToAgentId: string | null;
  domain: string;
  acceptedTriggers: readonly CompanyOsTriggerType[];
  requiredSources: readonly string[];
  allowedTools: readonly string[];
  allowedInternalTables: readonly string[];
  prohibitedTables: readonly string[];
  prohibitedActions: readonly string[];
  timeoutMs: number;
  concurrency: number;
  budgets: Readonly<{
    dailyTokens: number;
    monthlyTokens: number;
    maxOutputTokens: number;
    targetTotalTokensPerAttempt: number;
  }>;
  lowConfidencePolicy: Readonly<{
    minConfidence: number;
    action: 'ABSTAIN_AND_ESCALATE';
    caseStatus: 'NEEDS_REVIEW';
    escalationTarget: string;
    createReviewMessage: true;
  }>;
  inputSchemaVersion: number;
  outputSchemaVersion: number;
  inputSchema: StrictJsonObjectSchema;
  outputSchema: StrictJsonObjectSchema;
  escalationRules: readonly string[];
  handlerKey:
    | 'general-manager-advisory'
    | 'systems-manager-advisory'
    | 'data-manager-advisory';
  advisoryOnly: true;
  timeZone: typeof COMPANY_OS_TIME_ZONE;
  scheduleObjective?: string;
}>;

export type CompanyOsTeamMember = Readonly<{
  agentId: string;
  name: string;
  reportsToAgentId: string | null;
  status: CompanyOsAgentInstallationStatus;
  reason: string;
}>;

const COMMON_INTERNAL_TABLES = [
  'CompanyOsCase',
  'CompanyOsEvidenceRef',
  'CompanyOsMessage',
  'CompanyOsCaseEvent',
  'CompanyOsAuditEvent',
  'CompanyOsMission',
  'CompanyOsDecision',
  'CompanyOsExecutionAttempt',
  'CompanyOsLease',
  'CompanyOsLock',
  'CompanyOsUsage',
  'CompanyOsAgentSchedule',
  'CompanyOsHeartbeat',
  'CompanyOsWorkerHeartbeat',
  'CompanyOsNotificationDelivery',
  'CompanyOsWorkItem',
] as const;

const COMMON_INPUT_PROPERTIES = {
  requestId: { type: 'string', minLength: 1 },
  caseId: { type: 'string', minLength: 1 },
  leaseToken: { type: 'string', minLength: 1 },
  objective: { type: 'string', minLength: 1 },
  evidencePayload: {},
  contextMessages: { type: 'array', items: { type: 'object' } },
  budgets: {
    type: 'object',
    additionalProperties: false,
    required: ['maxOutputTokens', 'targetTotalTokens'],
    properties: {
      maxOutputTokens: { type: 'integer', minimum: 1 },
      targetTotalTokens: { type: 'integer', minimum: 1 },
    },
  },
} as const;

const GENERAL_MANAGER_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'summary',
    'primaryDataQualityProblem',
    'evidenceRefs',
    'recommendedNextStep',
    'missions',
    'delegations',
    'needsHumanDecision',
    'confidence',
  ],
  properties: {
    summary: { type: 'string', minLength: 1 },
    primaryDataQualityProblem: { type: 'string', minLength: 1 },
    evidenceRefs: { type: 'array', items: { type: 'string', minLength: 1 } },
    recommendedNextStep: { type: 'string', minLength: 1 },
    missions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'objective', 'evidenceRefs', 'status'],
        properties: {
          title: { type: 'string' },
          objective: { type: 'string', minLength: 1 },
          evidenceRefs: { type: 'array', items: { type: 'string', minLength: 1 } },
          status: { type: 'string', enum: ['PLANNED'] },
        },
      },
    },
    delegations: {
      type: 'array',
      maxItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['agentId', 'objective', 'evidenceRefs'],
        properties: {
          agentId: {
            type: 'string',
            enum: [COMPANY_OS_SYSTEMS_MANAGER_IDENTITY, COMPANY_OS_DATA_MANAGER_IDENTITY],
          },
          objective: { type: 'string', minLength: 1 },
          evidenceRefs: { type: 'array', items: { type: 'string', minLength: 1 } },
        },
      },
    },
    needsHumanDecision: { type: 'boolean' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
} as const satisfies StrictJsonObjectSchema;

const SYSTEMS_MANAGER_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'summary',
    'primaryConfirmedRisk',
    'primaryCoverageGap',
    'confirmedRiskNextStep',
    'coverageGapNextStep',
    'evidenceRefs',
    'actionableRisks',
    'missions',
    'needsHumanDecision',
    'confidence',
  ],
  properties: {
    summary: { type: 'string', minLength: 1 },
    primaryConfirmedRisk: { type: 'string', minLength: 1 },
    primaryCoverageGap: { type: 'string', minLength: 1 },
    confirmedRiskNextStep: { type: 'string', minLength: 1 },
    coverageGapNextStep: { type: 'string', minLength: 1 },
    evidenceRefs: { type: 'array', items: { type: 'string', minLength: 1 } },
    actionableRisks: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'riskId',
          'title',
          'assetId',
          'classification',
          'priority',
          'evidenceRefs',
        ],
        properties: {
          riskId: { type: 'string' },
          title: { type: 'string' },
          assetId: { type: 'string' },
          classification: { type: 'string', enum: ['ACTION_REQUIRED'] },
          priority: { type: 'integer', minimum: 0, maximum: 100 },
          evidenceRefs: { type: 'array', items: { type: 'string', minLength: 1 } },
        },
      },
    },
    missions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'objective', 'evidenceRefs', 'status'],
        properties: {
          title: { type: 'string' },
          objective: { type: 'string', minLength: 1 },
          evidenceRefs: { type: 'array', items: { type: 'string', minLength: 1 } },
          status: { type: 'string', enum: ['PLANNED'] },
        },
      },
    },
    needsHumanDecision: { type: 'boolean' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
} as const satisfies StrictJsonObjectSchema;

const GENERAL_MANAGER_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'requestId',
    'caseId',
    'leaseToken',
    'agentId',
    'objective',
    'evidencePayload',
    'budgets',
  ],
  properties: {
    ...COMMON_INPUT_PROPERTIES,
    agentId: { const: COMPANY_OS_V3_IDENTITY },
  },
} as const satisfies StrictJsonObjectSchema;

const SYSTEMS_MANAGER_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'requestId',
    'caseId',
    'leaseToken',
    'agentId',
    'objective',
    'evidencePayload',
    'budgets',
  ],
  properties: {
    ...COMMON_INPUT_PROPERTIES,
    agentId: { const: COMPANY_OS_SYSTEMS_MANAGER_IDENTITY },
  },
} as const satisfies StrictJsonObjectSchema;

const DATA_MANAGER_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'summary',
    'primaryDataQualityProblem',
    'primaryFreshnessGap',
    'recommendedNextStep',
    'evidenceRefs',
    'dataFindings',
    'missions',
    'needsHumanDecision',
    'confidence',
  ],
  properties: {
    summary: { type: 'string', minLength: 1 },
    primaryDataQualityProblem: { type: 'string', minLength: 1 },
    primaryFreshnessGap: { type: 'string', minLength: 1 },
    recommendedNextStep: { type: 'string', minLength: 1 },
    evidenceRefs: { type: 'array', items: { type: 'string', minLength: 1 } },
    dataFindings: {
      type: 'array',
      maxItems: 10,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['findingId', 'title', 'classification', 'priority', 'evidenceRefs'],
        properties: {
          findingId: { type: 'string', minLength: 1 },
          title: { type: 'string', minLength: 1 },
          classification: { type: 'string', enum: ['ACTION_REQUIRED', 'REVIEW', 'INFO'] },
          priority: { type: 'integer', minimum: 0, maximum: 100 },
          evidenceRefs: { type: 'array', items: { type: 'string', minLength: 1 } },
        },
      },
    },
    missions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'objective', 'evidenceRefs', 'status'],
        properties: {
          title: { type: 'string' },
          objective: { type: 'string', minLength: 1 },
          evidenceRefs: { type: 'array', items: { type: 'string', minLength: 1 } },
          status: { type: 'string', enum: ['PLANNED'] },
        },
      },
    },
    needsHumanDecision: { type: 'boolean' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
} as const satisfies StrictJsonObjectSchema;

const DATA_MANAGER_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'requestId',
    'caseId',
    'leaseToken',
    'agentId',
    'objective',
    'evidencePayload',
    'budgets',
  ],
  properties: {
    ...COMMON_INPUT_PROPERTIES,
    agentId: { const: COMPANY_OS_DATA_MANAGER_IDENTITY },
  },
} as const satisfies StrictJsonObjectSchema;

const CONTRACT_DEFINITIONS = {
  [COMPANY_OS_V3_IDENTITY]: {
    agentId: COMPANY_OS_V3_IDENTITY,
    name: COMPANY_OS_AGENT_CONTRACTS[COMPANY_OS_V3_IDENTITY].displayName,
    version: COMPANY_OS_RUNTIME_CONTRACT_VERSIONS[COMPANY_OS_V3_IDENTITY],
    reportsToAgentId: null,
    domain: 'GENERAL_MANAGEMENT',
    acceptedTriggers: ['MANUAL', 'SCHEDULE', 'EVENT', 'AGENT_MESSAGE'],
    requiredSources: [
      'CompanyOsCase.objective',
      'CompanyOsEvidenceRef.payload',
      'CompanyOsMessage.context',
      'server-materialized-business-snapshot',
      'CompanyOsAgentSchedule',
    ],
    allowedTools: [
      'openai.responses.structured-output',
      'company-os.evidence.read',
      'company-os.mission.append',
    ],
    allowedInternalTables: COMMON_INTERNAL_TABLES,
    prohibitedTables: COMPANY_OS_MANDATORY_PROHIBITED_TABLES,
    prohibitedActions: COMPANY_OS_MANDATORY_PROHIBITED_ACTIONS,
    timeoutMs: 120_000,
    concurrency: 1,
    budgets: {
      dailyTokens: 192_000,
      monthlyTokens: 1_000_000,
      maxOutputTokens: 3_000,
      targetTotalTokensPerAttempt: 12_000,
    },
    lowConfidencePolicy: {
      minConfidence: 0.75,
      action: 'ABSTAIN_AND_ESCALATE',
      caseStatus: 'NEEDS_REVIEW',
      escalationTarget: 'diego-ceo',
      createReviewMessage: true,
    },
    inputSchemaVersion: 1,
    outputSchemaVersion: 2,
    inputSchema: GENERAL_MANAGER_INPUT_SCHEMA,
    outputSchema: GENERAL_MANAGER_OUTPUT_SCHEMA,
    escalationRules: [
      'Escalate to Diego when confidence is below threshold.',
      'Escalate before any business-side mutation or external communication.',
      'Escalate conflicting or insufficient evidence; never infer missing facts.',
    ],
    handlerKey: 'general-manager-advisory',
    advisoryOnly: true,
    timeZone: COMPANY_OS_TIME_ZONE,
    scheduleObjective:
      'Revisá la evidencia empresarial y los resultados de los especialistas. Priorizá calidad de datos, ingesta y dependencia operativa. Delegá al Gerente de Datos una revisión concreta cuando falte evidencia; integrá su respuesta y cerrá con resultados y próximos pasos acotados. No repitas una delegación ya respondida ni solicites aprobación para analizar.',
  },
  [COMPANY_OS_SYSTEMS_MANAGER_IDENTITY]: {
    agentId: COMPANY_OS_SYSTEMS_MANAGER_IDENTITY,
    name: COMPANY_OS_AGENT_CONTRACTS[COMPANY_OS_SYSTEMS_MANAGER_IDENTITY].displayName,
    version: COMPANY_OS_RUNTIME_CONTRACT_VERSIONS[COMPANY_OS_SYSTEMS_MANAGER_IDENTITY],
    reportsToAgentId: COMPANY_OS_V3_IDENTITY,
    domain: 'SYSTEMS_INVENTORY_HEALTH_COVERAGE_AND_RISK',
    acceptedTriggers: ['MANUAL', 'SCHEDULE', 'AGENT_MESSAGE', 'INCIDENT'],
    requiredSources: [
      'CompanyOsCase.objective',
      'CompanyOsEvidenceRef.payload',
      'CompanyOsMessage.context',
      'CompanyOsSystemSnapshot',
      'CompanyOsSystemAsset',
      'CompanyOsSystemHealthObservation',
      'CompanyOsSystemCoverageObservation',
      'CompanyOsSystemRisk',
      'CompanyOsWorkerHeartbeat',
      'CompanyOsAgentSchedule',
    ],
    allowedTools: [
      'openai.responses.structured-output',
      'company-os.evidence.read',
      'company-os.systems-snapshot.read',
      'company-os.mission.append',
    ],
    allowedInternalTables: [
      ...COMMON_INTERNAL_TABLES,
      'CompanyOsSystemSnapshot',
      'CompanyOsSystemAsset',
      'CompanyOsSystemDependency',
      'CompanyOsSystemHealthObservation',
      'CompanyOsSystemCoverageObservation',
      'CompanyOsSystemRisk',
      'CompanyOsSystemRiskHistory',
    ],
    prohibitedTables: COMPANY_OS_MANDATORY_PROHIBITED_TABLES,
    prohibitedActions: COMPANY_OS_MANDATORY_PROHIBITED_ACTIONS,
    timeoutMs: 120_000,
    concurrency: 1,
    budgets: {
      dailyTokens: 48_000,
      monthlyTokens: 1_000_000,
      maxOutputTokens: 3_000,
      targetTotalTokensPerAttempt: 12_000,
    },
    lowConfidencePolicy: {
      minConfidence: 0.75,
      action: 'ABSTAIN_AND_ESCALATE',
      caseStatus: 'NEEDS_REVIEW',
      escalationTarget: COMPANY_OS_V3_IDENTITY,
      createReviewMessage: true,
    },
    inputSchemaVersion: 1,
    outputSchemaVersion: 1,
    inputSchema: SYSTEMS_MANAGER_INPUT_SCHEMA,
    outputSchema: SYSTEMS_MANAGER_OUTPUT_SCHEMA,
    escalationRules: [
      'Escalate unknown, degraded, or conflicting system evidence to General Manager.',
      'Escalate before deployment, merge, infrastructure change, or secret access.',
      'Escalate any recommendation that could mutate a business or external system.',
    ],
    handlerKey: 'systems-manager-advisory',
    advisoryOnly: true,
    timeZone: COMPANY_OS_TIME_ZONE,
    scheduleObjective:
      'Actualizá determinísticamente el inventario técnico, la salud, la cobertura y los riesgos observables. No ejecutes cambios ni reveles secretos.',
  },
  [COMPANY_OS_DATA_MANAGER_IDENTITY]: {
    agentId: COMPANY_OS_DATA_MANAGER_IDENTITY,
    name: COMPANY_OS_AGENT_CONTRACTS[COMPANY_OS_DATA_MANAGER_IDENTITY].displayName,
    version: COMPANY_OS_RUNTIME_CONTRACT_VERSIONS[COMPANY_OS_DATA_MANAGER_IDENTITY],
    reportsToAgentId: COMPANY_OS_V3_IDENTITY,
    domain: 'DATA_QUALITY_FRESHNESS_AND_COVERAGE',
    acceptedTriggers: ['MANUAL', 'SCHEDULE', 'EVENT', 'AGENT_MESSAGE'],
    requiredSources: [
      'CompanyOsCase.objective',
      'CompanyOsEvidenceRef.payload',
      'CompanyOsMessage.context',
      'server-materialized-business-snapshot',
      'CompanyOsAgentSchedule',
    ],
    allowedTools: [
      'ollama.chat.structured-output',
      'company-os.evidence.read',
      'company-os.data-quality.snapshot.read',
      'company-os.mission.append',
    ],
    allowedInternalTables: COMMON_INTERNAL_TABLES,
    prohibitedTables: COMPANY_OS_MANDATORY_PROHIBITED_TABLES,
    prohibitedActions: COMPANY_OS_MANDATORY_PROHIBITED_ACTIONS,
    timeoutMs: 120_000,
    concurrency: 1,
    budgets: {
      dailyTokens: 48_000,
      monthlyTokens: 1_000_000,
      maxOutputTokens: 3_000,
      targetTotalTokensPerAttempt: 12_000,
    },
    lowConfidencePolicy: {
      minConfidence: 0.75,
      action: 'ABSTAIN_AND_ESCALATE',
      caseStatus: 'NEEDS_REVIEW',
      escalationTarget: COMPANY_OS_V3_IDENTITY,
      createReviewMessage: true,
    },
    inputSchemaVersion: 1,
    outputSchemaVersion: 1,
    inputSchema: DATA_MANAGER_INPUT_SCHEMA,
    outputSchema: DATA_MANAGER_OUTPUT_SCHEMA,
    escalationRules: [
      'Escalate datos ausentes, obsoletos, contradictorios o con cobertura desconocida al Gerente General.',
      'Escalate antes de corregir, borrar, importar o mutar cualquier dato empresarial.',
      'No infieras stock, precios, costos, clientes o proveedores cuando la evidencia no esté materializada.',
    ],
    handlerKey: 'data-manager-advisory',
    advisoryOnly: true,
    timeZone: COMPANY_OS_TIME_ZONE,
    scheduleObjective:
      'Actualizá determinísticamente la calidad, frescura, consistencia y cobertura de las fuentes observables. No modifiques datos empresariales ni ejecutes compras.',
  },
} as const satisfies Record<CompanyOsInstalledAgentId, CompanyOsRuntimeContract>;

export const COMPANY_OS_RUNTIME_CONTRACTS: Readonly<
  Record<CompanyOsInstalledAgentId, CompanyOsRuntimeContract>
> = Object.freeze(CONTRACT_DEFINITIONS);

export const COMPANY_OS_TEAM_MANIFEST = [
  {
    agentId: COMPANY_OS_V3_IDENTITY,
    name: COMPANY_OS_AGENT_CONTRACTS[COMPANY_OS_V3_IDENTITY].displayName,
    reportsToAgentId: null,
    status: 'INSTALLED',
    reason: 'Dedicated claim handler and strict General Manager output contract exist.',
  },
  {
    agentId: COMPANY_OS_SYSTEMS_MANAGER_IDENTITY,
    name: COMPANY_OS_AGENT_CONTRACTS[COMPANY_OS_SYSTEMS_MANAGER_IDENTITY].displayName,
    reportsToAgentId: COMPANY_OS_V3_IDENTITY,
    status: 'INSTALLED',
    reason: 'Dedicated systems snapshot path and strict Systems Manager output contract exist.',
  },
  {
    agentId: COMPANY_OS_DATA_MANAGER_IDENTITY,
    name: COMPANY_OS_AGENT_CONTRACTS[COMPANY_OS_DATA_MANAGER_IDENTITY].displayName,
    reportsToAgentId: COMPANY_OS_V3_IDENTITY,
    status: 'INSTALLED',
    reason: 'Dedicated data snapshot inputs, executable handler, and strict Data Manager output contract exist.',
  },
  {
    agentId: 'ingestion-sync-ai-v1',
    name: 'Ingestion & Sync AI v1',
    reportsToAgentId: 'data-manager-ai-v1',
    status: 'NOT_INSTALLED',
    reason: 'No executable handler contract is present.',
  },
  {
    agentId: 'procurement-sourcing-ai-v1',
    name: 'Procurement & Sourcing AI v1',
    reportsToAgentId: COMPANY_OS_V3_IDENTITY,
    status: 'NOT_INSTALLED',
    reason: 'No executable handler contract is present.',
  },
  {
    agentId: 'pricing-margin-ai-v1',
    name: 'Pricing & Margin AI v1',
    reportsToAgentId: COMPANY_OS_V3_IDENTITY,
    status: 'NOT_INSTALLED',
    reason: 'No executable handler contract is present.',
  },
  {
    agentId: 'controller-finance-ai-v1',
    name: 'Controller & Finance AI v1',
    reportsToAgentId: COMPANY_OS_V3_IDENTITY,
    status: 'NOT_INSTALLED',
    reason: 'No executable handler contract is present.',
  },
] as const satisfies readonly CompanyOsTeamMember[];

const CONTRACT_REQUIRED_KEYS = [
  'agentId',
  'name',
  'version',
  'reportsToAgentId',
  'domain',
  'acceptedTriggers',
  'requiredSources',
  'allowedTools',
  'allowedInternalTables',
  'prohibitedTables',
  'prohibitedActions',
  'timeoutMs',
  'concurrency',
  'budgets',
  'lowConfidencePolicy',
  'inputSchemaVersion',
  'outputSchemaVersion',
  'inputSchema',
  'outputSchema',
  'escalationRules',
  'handlerKey',
  'advisoryOnly',
  'timeZone',
] as const;

const CONTRACT_ALLOWED_KEYS = new Set<string>([
  ...CONTRACT_REQUIRED_KEYS,
  'scheduleObjective',
]);

const HANDLER_BY_AGENT: Record<CompanyOsInstalledAgentId, string> = {
  [COMPANY_OS_V3_IDENTITY]: 'general-manager-advisory',
  [COMPANY_OS_SYSTEMS_MANAGER_IDENTITY]: 'systems-manager-advisory',
  [COMPANY_OS_DATA_MANAGER_IDENTITY]: 'data-manager-advisory',
};

const REPORTS_TO_BY_AGENT: Record<
  CompanyOsInstalledAgentId,
  string | null
> = {
  [COMPANY_OS_V3_IDENTITY]: null,
  [COMPANY_OS_SYSTEMS_MANAGER_IDENTITY]: COMPANY_OS_V3_IDENTITY,
  [COMPANY_OS_DATA_MANAGER_IDENTITY]: COMPANY_OS_V3_IDENTITY,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  allowed: ReadonlySet<string>,
  label: string,
): void {
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new Error(`${label}: missing required field ${key}`);
    }
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(`${label}: unknown field ${key}`);
    }
  }
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label}: expected non-empty string`);
  }
  return value;
}

function requireUniqueStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label}: expected non-empty array`);
  }
  const strings = value.map((item, index) =>
    requireNonEmptyString(item, `${label}[${index}]`),
  );
  if (new Set(strings).size !== strings.length) {
    throw new Error(`${label}: duplicate values are not allowed`);
  }
  return strings;
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label}: expected array`);
  }
  return value.map((item, index) =>
    requireNonEmptyString(item, `${label}[${index}]`),
  );
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new Error(`${label}: expected positive integer`);
  }
  return value as number;
}

function validateStrictSchema(value: unknown, label: string): void {
  if (!isRecord(value)) {
    throw new Error(`${label}: expected object schema`);
  }
  if (value.type !== 'object' || value.additionalProperties !== false) {
    throw new Error(`${label}: schema must be a strict object`);
  }
  const required = requireUniqueStringArray(value.required, `${label}.required`);
  if (!isRecord(value.properties)) {
    throw new Error(`${label}.properties: expected object`);
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value.properties, key)) {
      throw new Error(`${label}: required property ${key} is undefined`);
    }
  }
}

const STRUCTURED_OUTPUT_SCHEMA_KEYS = new Set([
  'type',
  'additionalProperties',
  'required',
  'properties',
  'items',
  'enum',
  'const',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'minimum',
  'maximum',
]);

function validateStructuredOutputSchema(
  value: unknown,
  label: string,
  depth = 0,
): void {
  if (!isRecord(value) || depth > 20) {
    throw new Error(`${label}: invalid structured output schema`);
  }
  for (const key of Object.keys(value)) {
    if (!STRUCTURED_OUTPUT_SCHEMA_KEYS.has(key)) {
      throw new Error(`${label}: unsupported structured output keyword ${key}`);
    }
  }
  if (value.enum !== undefined && (!Array.isArray(value.enum) || value.enum.length === 0)) {
    throw new Error(`${label}: enum must be a non-empty array`);
  }
  if (value.type === undefined && (value.const !== undefined || value.enum !== undefined)) return;
  if (!['object', 'array', 'string', 'boolean', 'number', 'integer'].includes(String(value.type))) {
    throw new Error(`${label}: unsupported structured output type`);
  }
  if (value.type === 'object') {
    if (value.additionalProperties !== false || !isRecord(value.properties) || !Array.isArray(value.required)) {
      throw new Error(`${label}: object schema must be strict`);
    }
    const propertyKeys = Object.keys(value.properties);
    const required = value.required;
    if (
      new Set(required).size !== required.length
      || required.some((key) => typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(value.properties, key))
      || propertyKeys.some((key) => !required.includes(key))
    ) {
      throw new Error(`${label}: object schema has inconsistent required fields`);
    }
    for (const [key, nested] of Object.entries(value.properties)) {
      validateStructuredOutputSchema(nested, `${label}.${key}`, depth + 1);
    }
  }
  if (value.type === 'array') {
    validateStructuredOutputSchema(value.items, `${label}[]`, depth + 1);
  }
}

export function isInstalledCompanyOsAgentId(
  agentId: string,
): agentId is CompanyOsInstalledAgentId {
  return (COMPANY_OS_INSTALLED_AGENT_IDS as readonly string[]).includes(agentId);
}

export function validateCompanyOsRuntimeContract(
  value: unknown,
): CompanyOsRuntimeContract {
  if (!isRecord(value)) {
    throw new Error('Company OS runtime contract must be an object');
  }

  requireExactKeys(
    value,
    CONTRACT_REQUIRED_KEYS,
    CONTRACT_ALLOWED_KEYS,
    'Company OS runtime contract',
  );

  const agentId = requireNonEmptyString(value.agentId, 'agentId');
  if (!isInstalledCompanyOsAgentId(agentId)) {
    throw new Error(`agentId ${agentId} is not installed`);
  }
  requireNonEmptyString(value.name, 'name');
  requireNonEmptyString(value.domain, 'domain');
  if (
    typeof value.version !== 'string' ||
    !/^\d+\.\d+\.\d+$/.test(value.version)
  ) {
    throw new Error('version must be an exact semantic version');
  }
  if (value.version !== COMPANY_OS_RUNTIME_CONTRACT_VERSIONS[agentId]) {
    throw new Error(`version does not match the installed contract for ${agentId}`);
  }
  if (value.reportsToAgentId !== REPORTS_TO_BY_AGENT[agentId]) {
    throw new Error(`reportsToAgentId does not match ${agentId}`);
  }
  if (value.advisoryOnly !== true) {
    throw new Error('advisoryOnly must be true');
  }
  if (value.timeZone !== COMPANY_OS_TIME_ZONE) {
    throw new Error(`timeZone must be ${COMPANY_OS_TIME_ZONE}`);
  }
  if (value.handlerKey !== HANDLER_BY_AGENT[agentId]) {
    throw new Error(`handlerKey does not match ${agentId}`);
  }

  const triggers = requireUniqueStringArray(value.acceptedTriggers, 'acceptedTriggers');
  for (const trigger of triggers) {
    if (!(COMPANY_OS_TRIGGER_TYPES as readonly string[]).includes(trigger)) {
      throw new Error(`unsupported trigger ${trigger}`);
    }
  }
  requireUniqueStringArray(value.requiredSources, 'requiredSources');
  requireUniqueStringArray(value.allowedTools, 'allowedTools');
  requireUniqueStringArray(value.allowedInternalTables, 'allowedInternalTables');
  const prohibitedTables = requireUniqueStringArray(
    value.prohibitedTables,
    'prohibitedTables',
  );
  const prohibitedActions = requireUniqueStringArray(
    value.prohibitedActions,
    'prohibitedActions',
  );
  for (const table of COMPANY_OS_MANDATORY_PROHIBITED_TABLES) {
    if (!prohibitedTables.includes(table)) {
      throw new Error(`prohibitedTables must include ${table}`);
    }
  }
  for (const action of COMPANY_OS_MANDATORY_PROHIBITED_ACTIONS) {
    if (!prohibitedActions.includes(action)) {
      throw new Error(`prohibitedActions must include ${action}`);
    }
  }
  const allowedTables = value.allowedInternalTables as string[];
  const contradictoryTable = allowedTables.find((table) => prohibitedTables.includes(table));
  if (contradictoryTable) {
    throw new Error(`table ${contradictoryTable} cannot be allowed and prohibited`);
  }

  const timeoutMs = requirePositiveInteger(value.timeoutMs, 'timeoutMs');
  if (timeoutMs > 300_000) {
    throw new Error('timeoutMs exceeds the fail-closed maximum');
  }
  if (requirePositiveInteger(value.concurrency, 'concurrency') !== 1) {
    throw new Error('concurrency must remain 1 until distributed locking is proven');
  }

  if (!isRecord(value.budgets)) {
    throw new Error('budgets must be an object');
  }
  requireExactKeys(
    value.budgets,
    [
      'dailyTokens',
      'monthlyTokens',
      'maxOutputTokens',
      'targetTotalTokensPerAttempt',
    ],
    new Set([
      'dailyTokens',
      'monthlyTokens',
      'maxOutputTokens',
      'targetTotalTokensPerAttempt',
    ]),
    'budgets',
  );
  const dailyTokens = requirePositiveInteger(value.budgets.dailyTokens, 'budgets.dailyTokens');
  const monthlyTokens = requirePositiveInteger(
    value.budgets.monthlyTokens,
    'budgets.monthlyTokens',
  );
  const maxOutputTokens = requirePositiveInteger(
    value.budgets.maxOutputTokens,
    'budgets.maxOutputTokens',
  );
  const targetTotalTokensPerAttempt = requirePositiveInteger(
    value.budgets.targetTotalTokensPerAttempt,
    'budgets.targetTotalTokensPerAttempt',
  );
  if (monthlyTokens < dailyTokens || targetTotalTokensPerAttempt > dailyTokens) {
    throw new Error('budgets are internally inconsistent');
  }
  if (maxOutputTokens >= targetTotalTokensPerAttempt) {
    throw new Error('maxOutputTokens must be lower than targetTotalTokensPerAttempt');
  }

  if (!isRecord(value.lowConfidencePolicy)) {
    throw new Error('lowConfidencePolicy must be an object');
  }
  requireExactKeys(
    value.lowConfidencePolicy,
    [
      'minConfidence',
      'action',
      'caseStatus',
      'escalationTarget',
      'createReviewMessage',
    ],
    new Set([
      'minConfidence',
      'action',
      'caseStatus',
      'escalationTarget',
      'createReviewMessage',
    ]),
    'lowConfidencePolicy',
  );
  if (
    typeof value.lowConfidencePolicy.minConfidence !== 'number' ||
    value.lowConfidencePolicy.minConfidence <= 0 ||
    value.lowConfidencePolicy.minConfidence >= 1
  ) {
    throw new Error('lowConfidencePolicy.minConfidence must be between 0 and 1');
  }
  if (
    value.lowConfidencePolicy.action !== 'ABSTAIN_AND_ESCALATE' ||
    value.lowConfidencePolicy.caseStatus !== 'NEEDS_REVIEW' ||
    value.lowConfidencePolicy.createReviewMessage !== true
  ) {
    throw new Error('lowConfidencePolicy must abstain, escalate, and create review evidence');
  }
  requireNonEmptyString(
    value.lowConfidencePolicy.escalationTarget,
    'lowConfidencePolicy.escalationTarget',
  );

  requirePositiveInteger(value.inputSchemaVersion, 'inputSchemaVersion');
  requirePositiveInteger(value.outputSchemaVersion, 'outputSchemaVersion');

  validateStrictSchema(value.inputSchema, 'inputSchema');
  validateStrictSchema(value.outputSchema, 'outputSchema');
  validateStructuredOutputSchema(value.outputSchema, 'outputSchema');
  const inputSchema = value.inputSchema as Record<string, unknown>;
  const inputProperties = inputSchema.properties as Record<string, unknown>;
  const inputAgentId = inputProperties.agentId;
  if (!isRecord(inputAgentId) || inputAgentId.const !== agentId) {
    throw new Error('inputSchema.agentId must be closed to the contract agentId');
  }
  requireUniqueStringArray(value.escalationRules, 'escalationRules');

  const acceptsSchedule = triggers.includes('SCHEDULE');
  const hasScheduleObjective =
    typeof value.scheduleObjective === 'string' && value.scheduleObjective.trim().length > 0;
  if (acceptsSchedule !== hasScheduleObjective) {
    throw new Error('scheduleObjective must exist if and only if SCHEDULE is accepted');
  }

  return value as unknown as CompanyOsRuntimeContract;
}

for (const contract of Object.values(COMPANY_OS_RUNTIME_CONTRACTS)) {
  validateCompanyOsRuntimeContract(contract);
}

export function getInstalledCompanyOsAgentIds(): readonly CompanyOsInstalledAgentId[] {
  return [...COMPANY_OS_INSTALLED_AGENT_IDS];
}

export function getCompanyOsAgentStatus(
  agentId: string,
): CompanyOsAgentInstallationStatus {
  const member = COMPANY_OS_TEAM_MANIFEST.find((item) => item.agentId === agentId);
  if (!member) {
    throw new Error(`Unknown Company OS agent: ${agentId}`);
  }
  return member.status;
}

export function getCompanyOsRuntimeContract(
  agentId: string,
): CompanyOsRuntimeContract {
  const status = getCompanyOsAgentStatus(agentId);
  if (status !== 'INSTALLED' || !isInstalledCompanyOsAgentId(agentId)) {
    throw new Error(`Company OS agent ${agentId} is NOT_INSTALLED`);
  }
  return validateCompanyOsRuntimeContract(COMPANY_OS_RUNTIME_CONTRACTS[agentId]);
}

export function getCompanyOsScheduleObjective(agentId: string): string {
  const contract = getCompanyOsRuntimeContract(agentId);
  if (
    !contract.acceptedTriggers.includes('SCHEDULE') ||
    typeof contract.scheduleObjective !== 'string' ||
    contract.scheduleObjective.trim().length === 0
  ) {
    throw new Error(`Company OS agent ${agentId} has no installed schedule contract`);
  }
  return contract.scheduleObjective;
}

export function getCompanyOsRuntimeOutputSchema(
  agentId: string,
): StrictJsonObjectSchema {
  return getCompanyOsRuntimeContract(agentId).outputSchema;
}

function validateMission(value: unknown, label: string): void {
  if (!isRecord(value)) {
    throw new Error(`${label}: expected mission object`);
  }
  requireExactKeys(
    value,
    ['title', 'objective', 'evidenceRefs', 'status'],
    new Set(['title', 'objective', 'evidenceRefs', 'status']),
    label,
  );
  requireNonEmptyString(value.title, `${label}.title`);
  requireNonEmptyString(value.objective, `${label}.objective`);
  requireStringArray(value.evidenceRefs, `${label}.evidenceRefs`);
  if (value.status !== 'PLANNED') {
    throw new Error(`${label}.status: only PLANNED is allowed`);
  }
}

function validateGeneralManagerOutput(
  value: Record<string, unknown>,
): CompanyOsGeneralManagerRuntimeOutput {
  requireExactKeys(
    value,
    [
      'summary',
      'primaryDataQualityProblem',
      'evidenceRefs',
      'recommendedNextStep',
      'missions',
      'delegations',
      'needsHumanDecision',
      'confidence',
    ],
    new Set([
      'summary',
      'primaryDataQualityProblem',
      'evidenceRefs',
      'recommendedNextStep',
      'missions',
      'delegations',
      'needsHumanDecision',
      'confidence',
    ]),
    'General Manager output',
  );
  requireNonEmptyString(value.summary, 'General Manager output.summary');
  requireNonEmptyString(
    value.primaryDataQualityProblem,
    'General Manager output.primaryDataQualityProblem',
  );
  requireStringArray(value.evidenceRefs, 'General Manager output.evidenceRefs');
  requireNonEmptyString(
    value.recommendedNextStep,
    'General Manager output.recommendedNextStep',
  );
  if (!Array.isArray(value.missions)) {
    throw new Error('General Manager output.missions: expected array');
  }
  value.missions.forEach((mission, index) =>
    validateMission(mission, `General Manager output.missions[${index}]`),
  );
  if (!Array.isArray(value.delegations)) {
    throw new Error('General Manager output.delegations: expected array');
  }
  if (value.delegations.length > 1) {
    throw new Error('General Manager output.delegations: expected at most one specialist handoff per turn');
  }
  value.delegations.forEach((delegation, index) => {
    const label = `General Manager output.delegations[${index}]`;
    if (!isRecord(delegation)) {
      throw new Error(`${label}: expected delegation object`);
    }
    requireExactKeys(
      delegation,
      ['agentId', 'objective', 'evidenceRefs'],
      new Set(['agentId', 'capability', 'objective', 'evidenceRefs', 'taskStatus', 'depth']),
      label,
    );
    validateSpecialistDelegation(delegation);
  });
  validateDecisionAndConfidence(
    value,
    COMPANY_OS_RUNTIME_CONTRACTS[COMPANY_OS_V3_IDENTITY],
    'General Manager output',
  );
  return value as CompanyOsGeneralManagerRuntimeOutput;
}

function validateSystemsManagerOutput(
  value: Record<string, unknown>,
): CompanyOsSystemsManagerRuntimeOutput {
  const keys = [
    'summary',
    'primaryConfirmedRisk',
    'primaryCoverageGap',
    'confirmedRiskNextStep',
    'coverageGapNextStep',
    'evidenceRefs',
    'actionableRisks',
    'missions',
    'needsHumanDecision',
    'confidence',
  ] as const;
  requireExactKeys(value, keys, new Set(keys), 'Systems Manager output');
  for (const key of keys.slice(0, 5)) {
    requireNonEmptyString(value[key], `Systems Manager output.${key}`);
  }
  requireStringArray(value.evidenceRefs, 'Systems Manager output.evidenceRefs');
  if (!Array.isArray(value.actionableRisks) || value.actionableRisks.length > 5) {
    throw new Error('Systems Manager output.actionableRisks: expected at most five items');
  }
  value.actionableRisks.forEach((risk, index) => {
    const label = `Systems Manager output.actionableRisks[${index}]`;
    if (!isRecord(risk)) {
      throw new Error(`${label}: expected risk object`);
    }
    const riskKeys = [
      'riskId',
      'title',
      'assetId',
      'classification',
      'priority',
      'evidenceRefs',
    ] as const;
    requireExactKeys(risk, riskKeys, new Set(riskKeys), label);
    requireNonEmptyString(risk.riskId, `${label}.riskId`);
    requireNonEmptyString(risk.title, `${label}.title`);
    requireNonEmptyString(risk.assetId, `${label}.assetId`);
    if (risk.classification !== 'ACTION_REQUIRED') {
      throw new Error(`${label}.classification: only ACTION_REQUIRED is allowed`);
    }
    if (
      !Number.isInteger(risk.priority) ||
      (risk.priority as number) < 0 ||
      (risk.priority as number) > 100
    ) {
      throw new Error(`${label}.priority: expected integer from 0 to 100`);
    }
    requireStringArray(risk.evidenceRefs, `${label}.evidenceRefs`);
  });
  if (!Array.isArray(value.missions)) {
    throw new Error('Systems Manager output.missions: expected array');
  }
  value.missions.forEach((mission, index) =>
    validateMission(mission, `Systems Manager output.missions[${index}]`),
  );
  validateDecisionAndConfidence(
    value,
    COMPANY_OS_RUNTIME_CONTRACTS[COMPANY_OS_SYSTEMS_MANAGER_IDENTITY],
    'Systems Manager output',
  );
  return value as CompanyOsSystemsManagerRuntimeOutput;
}

function validateDataManagerOutput(
  value: Record<string, unknown>,
): CompanyOsDataManagerRuntimeOutput {
  const keys = [
    'summary',
    'primaryDataQualityProblem',
    'primaryFreshnessGap',
    'recommendedNextStep',
    'evidenceRefs',
    'dataFindings',
    'missions',
    'needsHumanDecision',
    'confidence',
  ] as const;
  requireExactKeys(value, keys, new Set(keys), 'Data Manager output');
  for (const key of keys.slice(0, 4)) {
    requireNonEmptyString(value[key], `Data Manager output.${key}`);
  }
  requireStringArray(value.evidenceRefs, 'Data Manager output.evidenceRefs');
  if (!Array.isArray(value.dataFindings) || value.dataFindings.length > 10) {
    throw new Error('Data Manager output.dataFindings: expected at most ten items');
  }
  value.dataFindings.forEach((finding, index) => {
    const label = `Data Manager output.dataFindings[${index}]`;
    if (!isRecord(finding)) throw new Error(`${label}: expected finding object`);
    const findingKeys = ['findingId', 'title', 'classification', 'priority', 'evidenceRefs'] as const;
    requireExactKeys(finding, findingKeys, new Set(findingKeys), label);
    requireNonEmptyString(finding.findingId, `${label}.findingId`);
    requireNonEmptyString(finding.title, `${label}.title`);
    if (!['ACTION_REQUIRED', 'REVIEW', 'INFO'].includes(String(finding.classification))) {
      throw new Error(`${label}.classification: unsupported classification`);
    }
    if (!Number.isInteger(finding.priority) || (finding.priority as number) < 0 || (finding.priority as number) > 100) {
      throw new Error(`${label}.priority: expected integer from 0 to 100`);
    }
    requireStringArray(finding.evidenceRefs, `${label}.evidenceRefs`);
  });
  if (!Array.isArray(value.missions)) throw new Error('Data Manager output.missions: expected array');
  value.missions.forEach((mission, index) =>
    validateMission(mission, `Data Manager output.missions[${index}]`),
  );
  validateDecisionAndConfidence(
    value,
    COMPANY_OS_RUNTIME_CONTRACTS[COMPANY_OS_DATA_MANAGER_IDENTITY],
    'Data Manager output',
  );
  return value as CompanyOsDataManagerRuntimeOutput;
}

function validateDecisionAndConfidence(
  value: Record<string, unknown>,
  contract: CompanyOsRuntimeContract,
  label: string,
): void {
  if (typeof value.needsHumanDecision !== 'boolean') {
    throw new Error(`${label}.needsHumanDecision: expected boolean`);
  }
  if (
    typeof value.confidence !== 'number' ||
    !Number.isFinite(value.confidence) ||
    value.confidence < 0 ||
    value.confidence > 1
  ) {
    throw new Error(`${label}.confidence: expected finite number from 0 to 1`);
  }
  if (
    value.confidence < contract.lowConfidencePolicy.minConfidence &&
    value.needsHumanDecision !== true
  ) {
    throw new Error(`${label}: low confidence requires a human decision`);
  }
}

export function validateCompanyOsRuntimeOutput(
  agentId: string,
  value: unknown,
): CompanyOsRuntimeOutput {
  getCompanyOsRuntimeContract(agentId);
  if (!isRecord(value)) {
    throw new Error(`Company OS output for ${agentId} must be an object`);
  }
  if (agentId === COMPANY_OS_V3_IDENTITY) {
    return validateGeneralManagerOutput(value);
  }
  if (agentId === COMPANY_OS_SYSTEMS_MANAGER_IDENTITY) {
    return validateSystemsManagerOutput(value);
  }
  if (agentId === COMPANY_OS_DATA_MANAGER_IDENTITY) {
    return validateDataManagerOutput(value);
  }
  throw new Error(`No installed output validator for Company OS agent ${agentId}`);
}
