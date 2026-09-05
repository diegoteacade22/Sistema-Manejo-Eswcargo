import {
  COMPANY_OS_DATA_MANAGER_IDENTITY,
  COMPANY_OS_SYSTEMS_MANAGER_IDENTITY,
  COMPANY_OS_V3_IDENTITY,
} from './v3-types';

export const RUNTIME_RETRY_FAIRNESS_AGE_MS = 15 * 60_000;
export const RUNTIME_CONTINUATION_PRIORITY_GAP = 1;

export type RuntimeQueuePolicyCandidate = {
  workItemId: string;
  caseId: string;
  requestId: string;
  agentId: string;
  priority: number;
  attemptCount: number;
  availableAt: Date;
  nextAttemptAt: Date | null;
  createdAt: Date;
  familyLastCompletedAt: Date | null;
  causalCaseId: string | null;
  causalKind: string | null;
  causalMessageType: string | null;
  causalFromAgentId: string | null;
  causalToAgentId: string | null;
  causalDeliveryStatus: string | null;
  causalCorrelationId: string | null;
  causalIdempotencyKey: string | null;
  causalExpectsResponse: boolean | null;
  causalCausationId: string | null;
};

function eligibleAt(candidate: RuntimeQueuePolicyCandidate) {
  return candidate.nextAttemptAt ?? candidate.availableAt;
}

function hasAuthenticCausalEnvelope(candidate: RuntimeQueuePolicyCandidate) {
  return candidate.attemptCount === 0
    && candidate.causalCaseId === candidate.caseId
    && candidate.causalDeliveryStatus === 'DELIVERED'
    && candidate.causalCorrelationId === candidate.requestId
    && candidate.causalExpectsResponse === true
    && candidate.causalCausationId !== null;
}

export function isAuthenticatedRuntimeContinuation(candidate: RuntimeQueuePolicyCandidate) {
  if (!hasAuthenticCausalEnvelope(candidate)) return false;
  const idempotencyKey = candidate.causalIdempotencyKey ?? '';
  const specialistIds = [COMPANY_OS_SYSTEMS_MANAGER_IDENTITY, COMPANY_OS_DATA_MANAGER_IDENTITY];
  const delegation = specialistIds.includes(candidate.agentId as typeof specialistIds[number])
    && candidate.causalKind === 'ORDER'
    && candidate.causalMessageType === 'DELEGATION'
    && candidate.causalFromAgentId === COMPANY_OS_V3_IDENTITY
    && candidate.causalToAgentId === candidate.agentId
    && idempotencyKey.startsWith('runtime-message:')
    && idempotencyKey.includes(':delegation:')
    && idempotencyKey.endsWith(`:${candidate.agentId}`);
  const specialistResult = candidate.agentId === COMPANY_OS_V3_IDENTITY
    && candidate.causalKind === 'RESULT'
    && candidate.causalMessageType === 'SPECIALIST_RESULT'
    && specialistIds.includes(candidate.causalFromAgentId as typeof specialistIds[number])
    && candidate.causalToAgentId === COMPANY_OS_V3_IDENTITY
    && /^runtime-message:.+:attempt:\d+:result$/.test(idempotencyKey);
  return delegation || specialistResult;
}

export function runtimeQueuePolicyKey(
  candidate: RuntimeQueuePolicyCandidate,
  input: { now: Date; maxEligiblePriority: number },
) {
  const continuation = isAuthenticatedRuntimeContinuation(candidate)
    && candidate.priority >= input.maxEligiblePriority - RUNTIME_CONTINUATION_PRIORITY_GAP;
  const retryAgeMs = input.now.getTime() - eligibleAt(candidate).getTime();
  const retryLane = candidate.attemptCount > 0 && retryAgeMs >= RUNTIME_RETRY_FAIRNESS_AGE_MS
    ? 0
    : candidate.attemptCount === 0 ? 1 : 2;
  return [
    continuation ? 0 : 1,
    -candidate.priority,
    retryLane,
    candidate.attemptCount === 0
      ? candidate.familyLastCompletedAt?.getTime() ?? Number.NEGATIVE_INFINITY
      : 0,
    eligibleAt(candidate).getTime(),
    candidate.createdAt.getTime(),
    candidate.workItemId,
  ] as const;
}

export function compareRuntimeQueuePolicy(
  left: RuntimeQueuePolicyCandidate,
  right: RuntimeQueuePolicyCandidate,
  input: { now: Date; maxEligiblePriority: number },
) {
  const leftKey = runtimeQueuePolicyKey(left, input);
  const rightKey = runtimeQueuePolicyKey(right, input);
  for (let index = 0; index < leftKey.length; index += 1) {
    if (leftKey[index] === rightKey[index]) continue;
    return leftKey[index] < rightKey[index] ? -1 : 1;
  }
  return 0;
}
