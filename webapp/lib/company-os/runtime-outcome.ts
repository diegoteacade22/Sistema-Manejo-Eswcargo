import { COMPANY_OS_V3_IDENTITY } from './v3-types';

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
