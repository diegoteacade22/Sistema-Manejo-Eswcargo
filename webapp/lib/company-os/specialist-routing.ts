import {
  COMPANY_OS_DATA_MANAGER_IDENTITY,
  COMPANY_OS_SYSTEMS_MANAGER_IDENTITY,
  COMPANY_OS_V3_IDENTITY as COMPANY_OS_GENERAL_MANAGER_IDENTITY,
} from './v3-types';

export const SPECIALIST_CAPABILITIES = [
  'SYSTEMS_OBSERVABILITY',
  'DATA_QUALITY_FRESHNESS',
] as const;

export type SpecialistCapability = (typeof SPECIALIST_CAPABILITIES)[number];
export type RejectedSpecialistTaskStatus = 'NEEDS_USER' | 'BLOCKED_EXTERNAL';
export type SpecialistTaskStatus = 'READY' | RejectedSpecialistTaskStatus;
export type SpecialistAgentId =
  | typeof COMPANY_OS_SYSTEMS_MANAGER_IDENTITY
  | typeof COMPANY_OS_DATA_MANAGER_IDENTITY;

export type SpecialistDefinition = Readonly<{
  agentId: SpecialistAgentId;
  capability: SpecialistCapability;
  reportsToAgentId: typeof COMPANY_OS_GENERAL_MANAGER_IDENTITY;
  maxDepth: 1;
  allowedToolEffects: 'READ_ONLY_DETERMINISTIC';
}>;

export const SPECIALIST_REGISTRY: Readonly<Record<SpecialistCapability, SpecialistDefinition>> = Object.freeze({
  SYSTEMS_OBSERVABILITY: Object.freeze({
    agentId: COMPANY_OS_SYSTEMS_MANAGER_IDENTITY,
    capability: 'SYSTEMS_OBSERVABILITY',
    reportsToAgentId: COMPANY_OS_GENERAL_MANAGER_IDENTITY,
    maxDepth: 1,
    allowedToolEffects: 'READ_ONLY_DETERMINISTIC',
  }),
  DATA_QUALITY_FRESHNESS: Object.freeze({
    agentId: COMPANY_OS_DATA_MANAGER_IDENTITY,
    capability: 'DATA_QUALITY_FRESHNESS',
    reportsToAgentId: COMPANY_OS_GENERAL_MANAGER_IDENTITY,
    maxDepth: 1,
    allowedToolEffects: 'READ_ONLY_DETERMINISTIC',
  }),
});

const SPECIALIST_BY_AGENT = Object.freeze(
  Object.fromEntries(
    Object.values(SPECIALIST_REGISTRY).map((definition) => [definition.agentId, definition]),
  ) as Record<SpecialistAgentId, SpecialistDefinition>,
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function specialistGuardrailError(code: string, message: string): Error & { code: string; retryable: false } {
  return Object.assign(new Error(message), { code, retryable: false as const });
}

export function routeSpecialist(capability: string): SpecialistDefinition {
  const definition = SPECIALIST_REGISTRY[capability as SpecialistCapability];
  if (!definition) throw specialistGuardrailError('SPECIALIST_CAPABILITY_NOT_INSTALLED', `SPECIALIST_CAPABILITY_NOT_INSTALLED:${capability}`);
  return definition;
}

export function specialistCapabilityForAgent(agentId: string): SpecialistCapability {
  const definition = SPECIALIST_BY_AGENT[agentId as SpecialistAgentId];
  if (!definition) throw specialistGuardrailError('SPECIALIST_AGENT_NOT_INSTALLED', `SPECIALIST_AGENT_NOT_INSTALLED:${agentId}`);
  return definition.capability;
}

export function assertRunnableSpecialistTaskStatus(status: unknown): asserts status is 'READY' | undefined {
  if (status === 'NEEDS_USER' || status === 'BLOCKED_EXTERNAL') {
    throw specialistGuardrailError(`SPECIALIST_TASK_REJECTED_${status}`, `SPECIALIST_TASK_REJECTED:${status}`);
  }
  if (status !== undefined && status !== 'READY') {
    throw specialistGuardrailError('SPECIALIST_TASK_STATUS_INVALID', `SPECIALIST_TASK_STATUS_INVALID:${String(status)}`);
  }
}

export function validateSpecialistDelegation(value: unknown): {
  agentId: SpecialistAgentId;
  capability: SpecialistCapability;
  objective: string;
  evidenceRefs: string[];
  taskStatus?: SpecialistTaskStatus;
  depth: number;
} {
  if (!isRecord(value)) throw specialistGuardrailError('SPECIALIST_DELEGATION_INVALID', 'SPECIALIST_DELEGATION_INVALID');
  const agentId = nonEmptyString(value.agentId, 'SPECIALIST_DELEGATION_AGENT') as SpecialistAgentId;
  const definition = SPECIALIST_BY_AGENT[agentId];
  if (!definition) throw specialistGuardrailError('SPECIALIST_AGENT_NOT_INSTALLED', `SPECIALIST_AGENT_NOT_INSTALLED:${agentId}`);

  const capability = value.capability === undefined
    ? definition.capability
    : nonEmptyString(value.capability, 'SPECIALIST_DELEGATION_CAPABILITY') as SpecialistCapability;
  const routed = routeSpecialist(capability);
  if (routed.agentId !== agentId) {
    throw specialistGuardrailError('SPECIALIST_ROUTE_MISMATCH', `SPECIALIST_ROUTE_MISMATCH:${capability}:${agentId}`);
  }

  const objective = nonEmptyString(value.objective, 'SPECIALIST_DELEGATION_OBJECTIVE');
  if (objective.length > 600) throw specialistGuardrailError('SPECIALIST_DELEGATION_OBJECTIVE_TOO_LONG', 'SPECIALIST_DELEGATION_OBJECTIVE_TOO_LONG');
  const evidenceRefs = value.evidenceRefs;
  if (!Array.isArray(evidenceRefs) || evidenceRefs.length === 0
    || evidenceRefs.some((ref) => typeof ref !== 'string' || ref.trim().length === 0)
    || new Set(evidenceRefs).size !== evidenceRefs.length) {
    throw specialistGuardrailError('SPECIALIST_DELEGATION_EVIDENCE_INVALID', 'SPECIALIST_DELEGATION_EVIDENCE_INVALID');
  }

  const taskStatus = value.taskStatus as SpecialistTaskStatus | undefined;
  assertRunnableSpecialistTaskStatus(taskStatus);
  const depth = value.depth === undefined ? 1 : value.depth;
  if (!Number.isInteger(depth) || depth !== definition.maxDepth) {
    throw specialistGuardrailError('SPECIALIST_DEPTH_EXCEEDED', `SPECIALIST_DEPTH_EXCEEDED:${String(depth)}`);
  }

  return {
    agentId,
    capability,
    objective,
    evidenceRefs: evidenceRefs.map((ref) => ref.trim()),
    ...(taskStatus ? { taskStatus } : {}),
    depth,
  };
}
