import { createHash } from 'node:crypto';
import { posix } from 'node:path';

export const ENGINEERING_V2_CONTRACT_VERSION = '2.0.0' as const;

export const ENGINEERING_MISSION_STATES = [
  'DISCOVERED',
  'TRIAGED',
  'READY',
  'LEASED',
  'RUNNING',
  'VERIFYING',
  'REVIEWING',
  'AWAITING_APPROVAL',
  'READY_FOR_EFFECT',
  'READY_FOR_HUMAN',
  'COMPLETED',
  'BLOCKED_INPUT',
  'BLOCKED_AUTHORITY',
  'FAILED_RETRYABLE',
  'FAILED_FINAL',
  'CANCELLED',
] as const;

export type EngineeringMissionState = (typeof ENGINEERING_MISSION_STATES)[number];

export const ENGINEERING_EFFECT_STATES = [
  'PLANNED',
  'RESERVED',
  'DISPATCHING',
  'CONFIRMED',
  'FAILED',
  'UNKNOWN_OUTCOME',
  'REVERSED',
] as const;

export type EngineeringEffectState = (typeof ENGINEERING_EFFECT_STATES)[number];
export type EngineeringAutonomyLevel = 'A0' | 'A1' | 'A2' | 'A3' | 'A4';

export type EngineeringRuntimeControl = Readonly<{
  pauseIntake: boolean;
  pauseExecution: boolean;
  globalEmergencyStop: boolean;
  quarantinedRepositories: readonly string[];
  disabledActors: readonly string[];
}>;

export type EngineeringMissionContract = Readonly<{
  missionId: string;
  objective: string;
  repository: string;
  baseCommit: string;
  allowedPaths: readonly string[];
  acceptanceCriteria: readonly string[];
  autonomyLevel: EngineeringAutonomyLevel;
  budgetUsd: number;
  deadline: string;
  policyHash: string;
  expectedStateVersion: number;
}>;

export type EngineeringCapabilityLease = Readonly<{
  leaseId: string;
  missionId: string;
  missionHash: string;
  actor: string;
  resource: string;
  allowedVerbs: readonly string[];
  allowedPaths: readonly string[];
  autonomyLevel: EngineeringAutonomyLevel;
  budgetUsd: number;
  policyHash: string;
  fencingToken: number;
  expectedStateVersion: number;
  issuedAt: string;
  expiresAt: string;
}>;

export type EngineeringProofEvent = Readonly<{
  sequence: number;
  eventType: string;
  fromState: EngineeringMissionState | null;
  toState: EngineeringMissionState;
  payloadHash: string;
  previousHash: string | null;
  eventHash: string;
  createdAt: string;
}>;

export type EngineeringLoopBudget = Readonly<{
  attempts: number;
  maxAttempts: number;
  replans: number;
  maxReplans: number;
  spentUsd: number;
  maxUsd: number;
  deadline: string;
}>;

export type EngineeringEffectRequest = Readonly<{
  effectId: string;
  idempotencyKey: string;
  missionId: string;
  missionHash: string;
  targetRepository: string;
  verb: 'PUSH_BRANCH' | 'CREATE_DRAFT_PR' | 'COMMENT' | 'MERGE' | 'DEPLOY';
  policyHash: string;
  fencingToken: number;
}>;

const TRANSITIONS: Readonly<Record<EngineeringMissionState, readonly EngineeringMissionState[]>> = {
  DISCOVERED: ['TRIAGED', 'CANCELLED'],
  TRIAGED: ['READY', 'BLOCKED_INPUT', 'BLOCKED_AUTHORITY', 'CANCELLED'],
  READY: ['LEASED', 'BLOCKED_AUTHORITY', 'CANCELLED'],
  LEASED: ['RUNNING', 'FAILED_RETRYABLE', 'CANCELLED'],
  RUNNING: ['VERIFYING', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'BLOCKED_INPUT', 'BLOCKED_AUTHORITY', 'CANCELLED'],
  VERIFYING: ['REVIEWING', 'READY_FOR_EFFECT', 'READY_FOR_HUMAN', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'BLOCKED_INPUT'],
  REVIEWING: ['AWAITING_APPROVAL', 'READY_FOR_EFFECT', 'READY_FOR_HUMAN', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'BLOCKED_INPUT'],
  AWAITING_APPROVAL: ['READY_FOR_EFFECT', 'BLOCKED_AUTHORITY', 'CANCELLED'],
  READY_FOR_EFFECT: ['READY_FOR_HUMAN', 'COMPLETED', 'FAILED_RETRYABLE', 'FAILED_FINAL'],
  READY_FOR_HUMAN: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  BLOCKED_INPUT: ['READY', 'CANCELLED'],
  BLOCKED_AUTHORITY: ['READY', 'CANCELLED'],
  FAILED_RETRYABLE: ['READY', 'FAILED_FINAL', 'CANCELLED'],
  FAILED_FINAL: [],
  CANCELLED: [],
};

const A1_VERBS = new Set(['READ_REPOSITORY', 'WRITE_WORKTREE', 'RUN_TESTS', 'RUN_BUILD', 'COMMIT_LOCAL']);
const A2_VERBS = new Set([...A1_VERBS, 'PUSH_BRANCH', 'CREATE_DRAFT_PR', 'COMMENT']);

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function engineeringHash(value: unknown) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function engineeringMissionHash(mission: EngineeringMissionContract) {
  return engineeringHash({ contractVersion: ENGINEERING_V2_CONTRACT_VERSION, ...mission });
}

export function assertEngineeringTransition(from: EngineeringMissionState, to: EngineeringMissionState) {
  if (!TRANSITIONS[from].includes(to)) throw new Error(`ENGINEERING_INVALID_TRANSITION:${from}->${to}`);
  return to;
}

export function appendEngineeringProofEvent(input: {
  ledger: readonly EngineeringProofEvent[];
  eventType: string;
  fromState: EngineeringMissionState | null;
  toState: EngineeringMissionState;
  payload: unknown;
  createdAt: string;
}) {
  const previous = input.ledger.at(-1) ?? null;
  if (previous ? previous.toState !== input.fromState : input.fromState !== null) {
    throw new Error('ENGINEERING_LEDGER_STATE_DISCONTINUITY');
  }
  if (input.fromState) assertEngineeringTransition(input.fromState, input.toState);
  const sequence = (previous?.sequence ?? 0) + 1;
  const payloadHash = engineeringHash(input.payload);
  const eventBase = {
    sequence,
    eventType: input.eventType,
    fromState: input.fromState,
    toState: input.toState,
    payloadHash,
    previousHash: previous?.eventHash ?? null,
    createdAt: input.createdAt,
  };
  const event: EngineeringProofEvent = { ...eventBase, eventHash: engineeringHash(eventBase) };
  return [...input.ledger, event] as const;
}

export function verifyEngineeringProofLedger(ledger: readonly EngineeringProofEvent[]) {
  let previousHash: string | null = null;
  let previousState: EngineeringMissionState | null = null;
  for (let index = 0; index < ledger.length; index += 1) {
    const event = ledger[index];
    if (event.sequence !== index + 1 || event.previousHash !== previousHash) return false;
    if (index === 0 ? event.fromState !== null : event.fromState !== previousState) return false;
    if (event.fromState) {
      try {
        assertEngineeringTransition(event.fromState, event.toState);
      } catch {
        return false;
      }
    }
    const { eventHash, ...eventBase } = event;
    if (engineeringHash(eventBase) !== eventHash) return false;
    previousHash = eventHash;
    previousState = event.toState;
  }
  return true;
}

function pathAllowed(path: string, allowedPaths: readonly string[]) {
  const candidate = posix.normalize(path.replaceAll('\\', '/'));
  if (candidate === '..' || candidate.startsWith('../') || candidate.startsWith('/') || candidate.includes('\0')) return false;
  return allowedPaths.some((allowedPath) => {
    const allowed = posix.normalize(allowedPath.replaceAll('\\', '/')).replace(/\/$/, '');
    if (!allowed || allowed === '..' || allowed.startsWith('../') || allowed.startsWith('/')) return false;
    return candidate === allowed || candidate.startsWith(`${allowed}/`);
  });
}

export function validateEngineeringCapability(input: {
  mission: EngineeringMissionContract;
  lease: EngineeringCapabilityLease;
  control: EngineeringRuntimeControl;
  currentFencingToken: number;
  requestedVerb: string;
  requestedPath?: string;
  now: string;
}) {
  const { mission, lease, control } = input;
  const denial = (code: string) => ({ ok: false as const, code });
  if (control.globalEmergencyStop) return denial('GLOBAL_EMERGENCY_STOP');
  if (control.pauseExecution) return denial('EXECUTION_PAUSED');
  if (control.quarantinedRepositories.includes(mission.repository)) return denial('REPOSITORY_QUARANTINED');
  if (control.disabledActors.includes(lease.actor)) return denial('ACTOR_DISABLED');
  if (lease.missionId !== mission.missionId || lease.missionHash !== engineeringMissionHash(mission)) return denial('MISSION_HASH_MISMATCH');
  if (lease.resource !== mission.repository) return denial('RESOURCE_MISMATCH');
  if (lease.autonomyLevel !== mission.autonomyLevel) return denial('AUTONOMY_LEVEL_DENIED');
  if (lease.policyHash !== mission.policyHash) return denial('POLICY_HASH_MISMATCH');
  if (lease.expectedStateVersion !== mission.expectedStateVersion) return denial('STATE_VERSION_MISMATCH');
  if (lease.fencingToken !== input.currentFencingToken) return denial('STALE_FENCING_TOKEN');
  const now = Date.parse(input.now);
  const issuedAt = Date.parse(lease.issuedAt);
  const expiresAt = Date.parse(lease.expiresAt);
  const deadline = Date.parse(mission.deadline);
  if (![now, issuedAt, expiresAt, deadline].every(Number.isFinite)) return denial('CAPABILITY_TIME_INVALID');
  if (issuedAt > now) return denial('LEASE_NOT_ACTIVE');
  if (expiresAt <= now) return denial('LEASE_EXPIRED');
  if (deadline <= now) return denial('MISSION_DEADLINE_EXPIRED');
  if (lease.budgetUsd > mission.budgetUsd) return denial('BUDGET_ESCALATION');
  if (!lease.allowedVerbs.includes(input.requestedVerb)) return denial('VERB_NOT_ALLOWED');
  const allowedForLevel = lease.autonomyLevel === 'A1' ? A1_VERBS : lease.autonomyLevel === 'A2' ? A2_VERBS : new Set<string>();
  if (!allowedForLevel.has(input.requestedVerb)) return denial('AUTONOMY_LEVEL_DENIED');
  if (input.requestedPath && (
    !pathAllowed(input.requestedPath, mission.allowedPaths)
    || !pathAllowed(input.requestedPath, lease.allowedPaths)
  )) return denial('PATH_NOT_ALLOWED');
  return { ok: true as const, code: 'AUTHORIZED' };
}

export function engineeringProgressFingerprint(input: {
  state: EngineeringMissionState;
  evidenceRefs: readonly string[];
  diffHash: string | null;
  errorClass: string | null;
  toolRequest: string | null;
}) {
  return engineeringHash({
    ...input,
    evidenceRefs: [...input.evidenceRefs].sort(),
  });
}

export function evaluateEngineeringLoopBreaker(input: {
  fingerprints: readonly string[];
  budget: EngineeringLoopBudget;
  now: string;
}) {
  const last = input.fingerprints.at(-1);
  const repeated = Boolean(last && input.fingerprints.length >= 3 && input.fingerprints.slice(-3).every((item) => item === last));
  if (repeated) return { stop: true as const, code: 'NO_PROGRESS_REPEATED_3' };
  if (input.budget.attempts >= input.budget.maxAttempts) return { stop: true as const, code: 'ATTEMPT_LIMIT' };
  if (input.budget.replans >= input.budget.maxReplans) return { stop: true as const, code: 'REPLAN_LIMIT' };
  if (input.budget.spentUsd >= input.budget.maxUsd) return { stop: true as const, code: 'BUDGET_EXHAUSTED' };
  if (Date.parse(input.now) >= Date.parse(input.budget.deadline)) return { stop: true as const, code: 'DEADLINE_EXPIRED' };
  return { stop: false as const, code: 'CONTINUE' };
}

export function authorizeEngineeringEffect(input: {
  effect: EngineeringEffectRequest;
  mission: EngineeringMissionContract;
  lease: EngineeringCapabilityLease;
  control: EngineeringRuntimeControl;
  currentFencingToken: number;
  knownIdempotencyKeys: readonly string[];
  allowlistedRepositories: readonly string[];
  now: string;
}) {
  if (['MERGE', 'DEPLOY'].includes(input.effect.verb)) {
    return { ok: false as const, code: 'PRODUCTION_EFFECT_DENIED', dispatch: false as const };
  }
  if (input.effect.missionId !== input.mission.missionId) {
    return { ok: false as const, code: 'EFFECT_MISSION_ID_MISMATCH', dispatch: false as const };
  }
  if (input.effect.missionHash !== engineeringMissionHash(input.mission)) {
    return { ok: false as const, code: 'EFFECT_MISSION_HASH_MISMATCH', dispatch: false as const };
  }
  if (input.effect.targetRepository !== input.mission.repository) {
    return { ok: false as const, code: 'EFFECT_RESOURCE_MISMATCH', dispatch: false as const };
  }
  if (input.effect.policyHash !== input.mission.policyHash) {
    return { ok: false as const, code: 'EFFECT_POLICY_HASH_MISMATCH', dispatch: false as const };
  }
  if (input.effect.fencingToken !== input.currentFencingToken) {
    return { ok: false as const, code: 'EFFECT_STALE_FENCING_TOKEN', dispatch: false as const };
  }
  if (!input.allowlistedRepositories.includes(input.effect.targetRepository)) {
    return { ok: false as const, code: 'TARGET_NOT_ALLOWLISTED', dispatch: false as const };
  }
  if (input.knownIdempotencyKeys.includes(input.effect.idempotencyKey)) {
    return { ok: true as const, code: 'IDEMPOTENT_REPLAY', dispatch: false as const };
  }
  const capability = validateEngineeringCapability({
    mission: input.mission,
    lease: input.lease,
    control: input.control,
    currentFencingToken: input.currentFencingToken,
    requestedVerb: input.effect.verb,
    now: input.now,
  });
  if (!capability.ok) return { ...capability, dispatch: false as const };
  return { ok: true as const, code: 'AUTHORIZED', dispatch: true as const };
}

export function calculateEngineeringPriority(input: {
  probabilityOfSuccess: number;
  verifiedBenefitUsd: number;
  reviewCostUsd: number;
  reworkCostUsd: number;
  expectedLossUsd: number;
  executionCostUsd: number;
}) {
  const probability = Math.min(1, Math.max(0, input.probabilityOfSuccess));
  const expectedValue = probability * Math.max(0, input.verifiedBenefitUsd)
    - Math.max(0, input.reviewCostUsd)
    - Math.max(0, input.reworkCostUsd)
    - Math.max(0, input.expectedLossUsd)
    - Math.max(0, input.executionCostUsd);
  return { expectedValueUsd: Number(expectedValue.toFixed(2)), eligible: expectedValue > 0 };
}
