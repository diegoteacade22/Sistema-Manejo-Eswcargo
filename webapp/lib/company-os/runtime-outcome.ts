import { COMPANY_OS_V3_IDENTITY } from './v3-types';

type ReviewMessage = {
  id: string; fromAgentId: string | null; toAgentId: string | null;
  messageType: string | null; deliveryStatus: string; causationId: string | null;
  deliveredAt: Date | null; evidenceRefs: unknown; payload: unknown;
};
type ReviewWork = {
  id: string; agentId: string; status: string; causalMessageId: string | null;
  attempts: { outcome: string }[];
};
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const refs = (value: unknown) => Array.isArray(value) ? value.filter((ref): ref is string => typeof ref === 'string') : [];
const runnable = new Set(['QUEUED', 'CLAIMED', 'RUNNING', 'FAILED_RETRYABLE']);

/** Authority comes from the immutable intake context, never from the model's output. */
export function planRequiredRuntimeReview(input: {
  caseType: string; context: unknown; installedAgentIds: readonly string[];
  minimumConfidenceByAgent: Record<string, number>;
  currentWork: { id: string; agentId: string; causalMessageId: string | null };
  attemptStartedAt: Date; output: Record<string, unknown>;
  works: ReviewWork[]; messages: ReviewMessage[];
}) {
  const base = { requiredSpecialist: null as string | null, satisfied: true,
    action: 'NONE' as 'NONE' | 'DELEGATE' | 'INTEGRATE' | 'WAIT' | 'REVIEW',
    resultMessageId: null as string | null, evidenceRefs: [] as string[] };
  if (input.caseType !== 'CONTINUOUS_OBJECTIVE') return base;
  const context = record(input.context);
  // Missing context must not silently turn a continuous case into an ordinary advisory case.
  if (!('recommendedSpecialist' in context)) return { ...base, satisfied: false, action: 'REVIEW' as const };
  const specialist = context.recommendedSpecialist;
  if (specialist === null) return base;
  if (typeof specialist !== 'string' || specialist === COMPANY_OS_V3_IDENTITY || !input.installedAgentIds.includes(specialist)) {
    return { ...base, satisfied: false, action: 'REVIEW' as const };
  }
  const required = { ...base, requiredSpecialist: specialist, satisfied: false };
  const specialistWorks = input.works.filter((work) => work.agentId === specialist);
  const delivered = input.messages.find((message) => {
    if (message.messageType !== 'SPECIALIST_RESULT' || message.fromAgentId !== specialist
      || message.toAgentId !== COMPANY_OS_V3_IDENTITY || message.deliveryStatus !== 'DELIVERED' || !message.deliveredAt) return false;
    const payload = record(message.payload);
    if (payload.needsHumanDecision !== false || typeof payload.confidence !== 'number'
      || !Number.isFinite(payload.confidence) || payload.confidence > 1 || payload.confidence < (input.minimumConfidenceByAgent[specialist] ?? 1)
      || refs(message.evidenceRefs).length === 0) return false;
    const delegation = input.messages.find((order) => order.id === message.causationId
      && order.messageType === 'DELEGATION' && order.fromAgentId === COMPANY_OS_V3_IDENTITY
      && order.toAgentId === specialist && order.deliveryStatus === 'DELIVERED');
    return Boolean(delegation && specialistWorks.some((work) => work.causalMessageId === delegation.id
      && work.status === 'COMPLETED' && work.attempts.some((attempt) => attempt.outcome === 'SUCCEEDED')));
  });
  if (delivered) {
    const evidenceRefs = refs(delivered.evidenceRefs);
    const result = { ...required, resultMessageId: delivered.id, evidenceRefs };
    if (input.currentWork.agentId === COMPANY_OS_V3_IDENTITY && input.currentWork.causalMessageId === delivered.id
      && input.attemptStartedAt >= delivered.deliveredAt! && evidenceRefs.length > 0
      && evidenceRefs.every((ref) => refs(input.output.evidenceRefs).includes(ref))) {
      return { ...result, satisfied: true };
    }
    const pendingIntegration = input.works.some((work) => work.id !== input.currentWork.id
      && work.agentId === COMPANY_OS_V3_IDENTITY && work.causalMessageId === delivered.id && runnable.has(work.status));
    return { ...result, action: pendingIntegration ? 'WAIT' as const : 'INTEGRATE' as const };
  }
  if (specialistWorks.some((work) => runnable.has(work.status))) return { ...required, action: 'WAIT' as const };
  // A failed or completed-but-unproven review is not authorization to repeat its model call.
  return { ...required, action: specialistWorks.length ? 'REVIEW' as const : 'DELEGATE' as const };
}

// Completing an analysis never executes its PLANNED recommendations.
export function runtimeResultNeedsReview(input: {
  output: Record<string, unknown>;
  agentId: string;
  canContinue: boolean;
  minConfidence: number;
}) {
  const { output, agentId, canContinue, minConfidence } = input;
  const confidence = Number(output.confidence);
  const pendingDelegation = Array.isArray(output.delegations) && output.delegations.length > 0;
  return output.needsHumanDecision === true
    || !Number.isFinite(confidence) || confidence < minConfidence
    || (!canContinue && (pendingDelegation || agentId !== COMPANY_OS_V3_IDENTITY));
}
