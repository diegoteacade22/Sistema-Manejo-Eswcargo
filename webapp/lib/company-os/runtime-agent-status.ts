export type RuntimeAgentStateWork = {
  agentId: string;
  status: string;
  requestId: string;
  updatedAt: Date;
  completedAt: Date | null;
  leaseWorkerId: string | null;
  leaseExpiresAt: Date | null;
};

type RuntimeAgentStateWorker = {
  workerId: string;
  state: string;
  allowedAgentIds: string[];
  lastHeartbeatAt: Date;
};

// Historical work remains in the queue/history; this describes current execution capability.
export function deriveRuntimeAgentState(input: {
  agentId: string;
  installed: boolean;
  paused: boolean;
  now: Date;
  staleMs: number;
  workers: RuntimeAgentStateWorker[];
  workItems: RuntimeAgentStateWork[];
}) {
  const state = (status: string, currentCaseId: string | null = null) => ({ status, currentCaseId });
  if (!input.installed) return state('NOT_INSTALLED');
  if (input.paused) return state('PAUSED');
  const now = input.now.getTime();
  const freshWorkers = input.workers.filter((worker) => worker.allowedAgentIds.includes(input.agentId)
    && worker.state !== 'STOPPED'
    && now - worker.lastHeartbeatAt.getTime() <= input.staleMs);
  if (!freshWorkers.length) return state('UNKNOWN');

  const workItems = input.workItems.filter((work) => work.agentId === input.agentId);
  const active = workItems.filter((work) => work.status === 'CLAIMED' || work.status === 'RUNNING');
  const liveWork = active.find((work) => work.leaseExpiresAt && work.leaseExpiresAt.getTime() > now
    && freshWorkers.some((worker) => worker.workerId === work.leaseWorkerId));
  if (liveWork) return state('RUNNING', liveWork.requestId);
  if (active.length) return state('UNKNOWN');
  if (!freshWorkers.some((worker) => ['IDLE', 'BUSY', 'DEGRADED'].includes(worker.state))) return state('UNKNOWN');

  const lastSuccess = Math.max(0, ...workItems.filter((work) => work.status === 'COMPLETED')
    .map((work) => (work.completedAt ?? work.updatedAt).getTime()));
  const lastProblem = Math.max(0, ...workItems.filter((work) => ['BLOCKED', 'FAILED_RETRYABLE', 'FAILED_FINAL'].includes(work.status))
    .map((work) => work.updatedAt.getTime()));
  return state(lastProblem > 0 && lastProblem >= lastSuccess ? 'BLOCKED' : 'IDLE');
}
