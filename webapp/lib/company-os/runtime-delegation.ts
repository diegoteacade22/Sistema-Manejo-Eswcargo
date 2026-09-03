type Delegation = { agentId: string; objective: string; evidenceRefs: string[] };
type CompletedDelegation = Delegation & { workItemId: string };

function normalizedObjective(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');
}

// A completed initial analysis covers its whole immutable evidence snapshot.
// A narrower repeat adds no evidence; a new evidence reference or objective does.
export function findCompletedRuntimeDelegation(delegation: Delegation, completed: CompletedDelegation[]) {
  const objective = normalizedObjective(delegation.objective);
  return completed.find((prior) => prior.agentId === delegation.agentId
    && normalizedObjective(prior.objective) === objective
    && delegation.evidenceRefs.every((ref) => prior.evidenceRefs.includes(ref))) ?? null;
}

export function runtimeFollowUpCapacity(completedTurns: number, maxTurns: number, pendingTurns = 0) {
  const remainingTurns = Math.max(0, maxTurns - completedTurns - pendingTurns);
  return {
    canReturnToGeneral: remainingTurns >= 1,
    canDelegateToSpecialist: remainingTurns >= 2,
  };
}
