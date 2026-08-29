import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  assertEngineeringTransition,
  ENGINEERING_V2_CONTRACT_VERSION,
  engineeringGoalEpochResetObserved,
  engineeringGoalRequestId,
  engineeringHash,
  engineeringMissionHash,
  type EngineeringAutonomyLevel,
  type EngineeringMissionContract,
  type EngineeringMissionState,
} from './autonomous-engineering-v2';
import { sanitizeCompanyText } from './objective';
import { companyOsV3Prisma } from './v3-prisma';

type Tx = Prisma.TransactionClient;

const ENGINEERING_CONTROL_ID = 'primary';
const ENGINEERING_ACTOR = 'diegoserver-engineering-v2';
const ALLOWED_REPOSITORY = 'diegoteacade22/Sistema-Manejo-Eswcargo';
const ACTIVE_LEASE_MS = 5 * 60_000;
const MAX_OBJECTIVE_LENGTH = 4_000;
const MAX_EVENT_PAYLOAD_BYTES = 64 * 1024;
const PROHIBITED_PATHS = [
  '.env', '.git', '.vercel', '.github', 'supabase/migrations', 'webapp/prisma/migrations',
  'company-os/runtime', 'company-os/engineering-runtime',
] as const;

const A1_VERBS = ['READ_REPOSITORY', 'WRITE_WORKTREE', 'RUN_TESTS', 'RUN_BUILD', 'COMMIT_LOCAL'] as const;
const A2_VERBS = [...A1_VERBS, 'PUSH_BRANCH', 'CREATE_DRAFT_PR'] as const;
const ACTIVE_MISSION_STATES = ['LEASED', 'RUNNING', 'VERIFYING', 'REVIEWING'] as const;
const GOAL_SIGNAL_MAX_BYTES = 16 * 1024;
const ENGINEERING_RETRY_BASE_MS = 30_000;
const ENGINEERING_RETRY_MAX_MS = 15 * 60_000;

export class EngineeringStoreError extends Error {
  constructor(message: string, readonly status = 409, readonly code = 'ENGINEERING_STATE_REJECTED') {
    super(message);
    this.name = 'EngineeringStoreError';
  }
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new EngineeringStoreError('Objeto de ingeniería inválido', 400, 'INVALID_ENGINEERING_OBJECT');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, max = 500) {
  const source = typeof value === 'string' ? value : '';
  const safe = sanitizeCompanyText(source, max).safeText.trim();
  if (!safe) throw new EngineeringStoreError('Texto obligatorio ausente', 400, 'INVALID_ENGINEERING_TEXT');
  return safe;
}

function opaqueHex(value: unknown, length: 40 | 64, message: string, code: string) {
  const source = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (source.length !== length || !/^[a-f0-9]+$/.test(source)) {
    throw new EngineeringStoreError(message, 400, code);
  }
  return source;
}

function opaqueIdentifier(value: unknown, max: number, pattern: RegExp, message: string, code: string) {
  const source = typeof value === 'string' ? value.trim() : '';
  if (!source || source.length > max || !pattern.test(source)) {
    throw new EngineeringStoreError(message, 400, code);
  }
  return source;
}

function stringArray(value: unknown, maxItems: number, maxLength: number) {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxItems) {
    throw new EngineeringStoreError('Lista de ingeniería inválida', 400, 'INVALID_ENGINEERING_LIST');
  }
  return [...new Set(value.map((item) => text(item, maxLength)))];
}

function safeRelativePath(value: string) {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
  if (!normalized || normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../')
    || normalized.includes('/../') || normalized.includes('\0')) {
    throw new EngineeringStoreError(`Path fuera de scope: ${value}`, 400, 'PATH_NOT_ALLOWED');
  }
  if (PROHIBITED_PATHS.some((blocked) => normalized === blocked || normalized.startsWith(`${blocked}/`))) {
    throw new EngineeringStoreError(`Path prohibido: ${normalized}`, 400, 'PATH_NOT_ALLOWED');
  }
  return normalized;
}

function relativePathArray(value: unknown, maxItems: number, maxLength: number) {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxItems) {
    throw new EngineeringStoreError('Lista de paths inválida', 400, 'INVALID_ENGINEERING_PATH_LIST');
  }
  return [...new Set(value.map((item) => safeRelativePath(opaqueIdentifier(
    item,
    maxLength,
    /^[^\u0000-\u001f\u007f]+$/,
    'Path de ingeniería inválido',
    'PATH_NOT_ALLOWED',
  ))))];
}

function decimalNumber(value: Prisma.Decimal | number | string) {
  return Number(value);
}

function missionContract(mission: {
  id: string;
  contractVersion: string;
  objective: string;
  repository: string;
  baseCommit: string;
  allowedPaths: Prisma.JsonValue;
  acceptanceCriteria: Prisma.JsonValue;
  desiredState: Prisma.JsonValue | null;
  autonomyLevel: string;
  budgetUsd: Prisma.Decimal;
  deadline: Date;
  policyHash: string;
  stateVersion: number;
}): EngineeringMissionContract {
  const baseContract = {
    missionId: mission.id,
    objective: mission.objective,
    repository: mission.repository,
    baseCommit: mission.baseCommit,
    allowedPaths: Array.isArray(mission.allowedPaths) ? mission.allowedPaths.filter((item): item is string => typeof item === 'string') : [],
    acceptanceCriteria: Array.isArray(mission.acceptanceCriteria)
      ? mission.acceptanceCriteria.filter((item): item is string => typeof item === 'string') : [],
    autonomyLevel: mission.autonomyLevel as EngineeringAutonomyLevel,
    budgetUsd: decimalNumber(mission.budgetUsd),
    deadline: mission.deadline.toISOString(),
    policyHash: mission.policyHash,
    expectedStateVersion: mission.stateVersion,
  };
  if (mission.contractVersion === '2.0.0') {
    // Preserve the exact legacy wire shape so a 2.0 worker computes the same
    // immutable hash during a rolling deploy or rollback.
    return baseContract as unknown as EngineeringMissionContract;
  }
  return {
    contractVersion: ENGINEERING_V2_CONTRACT_VERSION,
    ...baseContract,
    desiredState: mission.desiredState === null ? null : fileContainsDesiredState(mission.desiredState),
  };
}

async function appendEvent(tx: Tx, input: {
  missionId: string;
  eventType: string;
  fromStatus: EngineeringMissionState | null;
  toStatus: EngineeringMissionState;
  payload: unknown;
  idempotencyKey: string;
  fencingToken?: bigint | null;
}) {
  if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) {
    throw new EngineeringStoreError('Payload de evento debe ser objeto', 400, 'INVALID_ENGINEERING_EVENT');
  }
  const payloadText = JSON.stringify(input.payload ?? {});
  if (Buffer.byteLength(payloadText, 'utf8') > MAX_EVENT_PAYLOAD_BYTES) {
    throw new EngineeringStoreError('Payload de evento demasiado grande', 413, 'ENGINEERING_EVENT_TOO_LARGE');
  }
  const requestHash = engineeringHash({
    eventType: input.eventType,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    payload: input.payload ?? {},
    fencingToken: input.fencingToken?.toString() ?? null,
  });
  const prior = await tx.companyOsEngineeringEvent.findUnique({
    where: { missionId_idempotencyKey: { missionId: input.missionId, idempotencyKey: input.idempotencyKey } },
  });
  if (prior) {
    if (prior.requestHash !== requestHash) {
      throw new EngineeringStoreError('idempotencyKey reutilizada con otro evento', 409, 'IDEMPOTENCY_CONFLICT');
    }
    return prior;
  }
  const previous = await tx.companyOsEngineeringEvent.findFirst({
    where: { missionId: input.missionId }, orderBy: { sequence: 'desc' },
  });
  const sequence = (previous?.sequence ?? 0) + 1;
  const payloadHash = engineeringHash(input.payload ?? {});
  const eventBase = {
    missionId: input.missionId,
    sequence,
    eventType: input.eventType,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    payloadHash,
    previousHash: previous?.eventHash ?? null,
    idempotencyKey: input.idempotencyKey,
    requestHash,
    fencingToken: input.fencingToken?.toString() ?? null,
  };
  return tx.companyOsEngineeringEvent.create({ data: {
    id: `engineering-event:${randomUUID()}`,
    missionId: input.missionId,
    sequence,
    eventType: input.eventType,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    payload: jsonValue(input.payload ?? {}),
    payloadHash,
    previousHash: previous?.eventHash ?? null,
    eventHash: engineeringHash(eventBase),
    idempotencyKey: input.idempotencyKey,
    requestHash,
    fencingToken: input.fencingToken ?? null,
  } });
}

async function setMissionStatus(tx: Tx, input: {
  missionId: string;
  fromStatus: EngineeringMissionState;
  toStatus: EngineeringMissionState;
  eventType: string;
  payload: unknown;
  idempotencyKey: string;
  fencingToken?: bigint | null;
  completedAt?: Date | null;
}) {
  assertEngineeringTransition(input.fromStatus, input.toStatus);
  await appendEvent(tx, input);
  const updated = await tx.companyOsEngineeringMission.updateMany({
    where: { id: input.missionId, status: input.fromStatus },
    data: {
      status: input.toStatus,
      stateVersion: { increment: 1 },
      ...(input.completedAt !== undefined ? { completedAt: input.completedAt } : {}),
    },
  });
  if (updated.count !== 1) throw new EngineeringStoreError('La misión cambió de estado concurrentemente', 409, 'MISSION_STATE_CONFLICT');
}

async function requireControlAllows(tx: Tx, input: { repository: string; actor: string; intake?: boolean }) {
  const control = await tx.companyOsEngineeringControl.findUniqueOrThrow({ where: { id: ENGINEERING_CONTROL_ID } });
  if (control.emergencyStop) throw new EngineeringStoreError('Emergency stop activo', 423, 'GLOBAL_EMERGENCY_STOP');
  if (input.intake ? control.pauseIntake : control.pauseExecution) {
    throw new EngineeringStoreError(input.intake ? 'Intake pausado' : 'Ejecución pausada', 423, input.intake ? 'INTAKE_PAUSED' : 'EXECUTION_PAUSED');
  }
  if (control.quarantinedRepositories.includes(input.repository)) {
    throw new EngineeringStoreError('Repositorio en cuarentena', 423, 'REPOSITORY_QUARANTINED');
  }
  if (control.disabledActors.includes(input.actor)) {
    throw new EngineeringStoreError('Actor deshabilitado', 423, 'ACTOR_DISABLED');
  }
  return control;
}

async function requireGoalAllowsMission(tx: Tx, mission: { goalId: string | null }) {
  if (!mission.goalId) return;
  const goal = await tx.companyOsEngineeringGoal.findUnique({ where: { id: mission.goalId } });
  if (!goal || goal.status !== 'ACTIVE') {
    throw new EngineeringStoreError('GoalSpec revocado o pausado', 409, 'ENGINEERING_GOAL_NOT_ACTIVE');
  }
  const latestSignal = await tx.companyOsEngineeringGoalSignal.findFirst({
    where: { goalId: mission.goalId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  if (!latestSignal) {
    throw new EngineeringStoreError('GoalSpec sin observación durable', 409, 'ENGINEERING_GOAL_UNOBSERVED');
  }
  const latestState = record(latestSignal.observedState);
  if (latestState.type === 'GOAL_ISSUE') {
    throw new EngineeringStoreError('GoalSpec con fuente stale', 409, 'ENGINEERING_GOAL_STALE');
  }
  if (latestSignal.observedSatisfied) {
    throw new EngineeringStoreError('GoalSpec ya satisfecho', 409, 'ENGINEERING_GOAL_ALREADY_SATISFIED');
  }
}

async function requireLease(tx: Tx, input: {
  missionId: string;
  leaseId: string;
  fencingToken: bigint;
  actor?: string;
  allowExpired?: boolean;
  allowExpiredMission?: boolean;
  allowGoalRevoked?: boolean;
}) {
  const mission = await tx.companyOsEngineeringMission.findUniqueOrThrow({ where: { id: input.missionId } });
  await requireControlAllows(tx, { repository: mission.repository, actor: input.actor ?? ENGINEERING_ACTOR });
  if (!input.allowGoalRevoked) await requireGoalAllowsMission(tx, mission);
  const lease = await tx.companyOsEngineeringCapabilityLease.findUnique({ where: { id: input.leaseId } });
  if (!lease || lease.missionId !== mission.id || lease.fencingToken !== input.fencingToken
    || lease.fencingToken !== mission.fencingCounter || lease.status !== 'ACTIVE'
    || (!input.allowExpired && lease.expiresAt <= new Date())) {
    throw new EngineeringStoreError('Capability lease inválida, vencida o fenced', 409, 'STALE_FENCING_TOKEN');
  }
  if (!input.allowExpiredMission && mission.deadline <= new Date()) {
    throw new EngineeringStoreError('Deadline de misión vencido', 409, 'ENGINEERING_MISSION_DEADLINE_EXPIRED');
  }
  return { mission, lease };
}

export async function enqueueEngineeringMission(rawInput: unknown, actorRef: string) {
  const input = record(rawInput);
  if (input.goalId !== undefined) {
    throw new EngineeringStoreError('goalId está reservado al reconciliador determinístico', 400, 'ENGINEERING_GOAL_ID_RESERVED');
  }
  const goalId = null;
  const repository = text(input.repository, 200);
  if (repository !== ALLOWED_REPOSITORY) throw new EngineeringStoreError('Repositorio no allowlisted', 403, 'TARGET_NOT_ALLOWLISTED');
  const objective = text(input.objective, MAX_OBJECTIVE_LENGTH);
  const baseCommit = opaqueHex(input.baseCommit, 40, 'baseCommit inválido', 'INVALID_BASE_COMMIT');
  const allowedPaths = relativePathArray(input.allowedPaths, 30, 300);
  const acceptanceCriteria = stringArray(input.acceptanceCriteria, 30, 500);
  const autonomyLevel = input.autonomyLevel === 'A2' ? 'A2' : input.autonomyLevel === 'A1' ? 'A1' : null;
  if (!autonomyLevel) throw new EngineeringStoreError('Sólo A1/A2 están habilitados', 400, 'AUTONOMY_LEVEL_DENIED');
  const budgetUsd = Number(input.budgetUsd);
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0 || budgetUsd > 10) {
    throw new EngineeringStoreError('Presupuesto fuera de límite', 400, 'INVALID_BUDGET');
  }
  const deadline = new Date(String(input.deadline ?? ''));
  if (Number.isNaN(deadline.getTime()) || deadline <= new Date() || deadline.getTime() > Date.now() + 24 * 60 * 60_000) {
    throw new EngineeringStoreError('Deadline fuera de límite', 400, 'INVALID_DEADLINE');
  }
  const policyHash = opaqueHex(input.policyHash, 64, 'policyHash inválido', 'INVALID_POLICY_HASH');
  const requestId = opaqueIdentifier(
    input.requestId,
    160,
    /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/,
    'requestId inválido',
    'INVALID_REQUEST_ID',
  );
  const missionId = `engineering-mission:${randomUUID()}`;
  const contract: EngineeringMissionContract = {
    contractVersion: ENGINEERING_V2_CONTRACT_VERSION,
    missionId, objective, repository, baseCommit, allowedPaths, acceptanceCriteria, autonomyLevel,
    desiredState: null, budgetUsd, deadline: deadline.toISOString(), policyHash, expectedStateVersion: 1,
  };
  const missionHash = engineeringMissionHash(contract);
  const db = companyOsV3Prisma();
  return db.$transaction(async (tx) => {
    await requireControlAllows(tx, { repository, actor: ENGINEERING_ACTOR, intake: true });
    const existing = await tx.companyOsEngineeringMission.findUnique({ where: { requestId } });
    if (existing) {
      const sameRequest = existing.objective === objective
        && existing.goalId === goalId
        && existing.repository === repository
        && existing.baseCommit === baseCommit
        && JSON.stringify(existing.allowedPaths) === JSON.stringify(allowedPaths)
        && JSON.stringify(existing.acceptanceCriteria) === JSON.stringify(acceptanceCriteria)
        && existing.autonomyLevel === autonomyLevel
        && decimalNumber(existing.budgetUsd) === budgetUsd
        && existing.deadline.getTime() === deadline.getTime()
        && existing.policyHash === policyHash;
      if (!sameRequest) throw new EngineeringStoreError('requestId reutilizado con otra misión', 409, 'IDEMPOTENCY_CONFLICT');
      return { reused: true, missionId: existing.id, missionHash: existing.missionHash, status: existing.status };
    }
    await tx.companyOsEngineeringMission.create({ data: {
      id: missionId, requestId, missionHash, goalId, contractVersion: ENGINEERING_V2_CONTRACT_VERSION, objective, repository, baseCommit,
      allowedPaths: jsonValue(allowedPaths), acceptanceCriteria: jsonValue(acceptanceCriteria),
      desiredState: Prisma.DbNull, autonomyLevel, budgetUsd, deadline, policyHash, stateVersion: 1, status: 'DISCOVERED',
    } });
    await appendEvent(tx, {
      missionId, eventType: 'MISSION_DISCOVERED', fromStatus: null, toStatus: 'DISCOVERED',
      payload: { requestId, missionHash, actorRef }, idempotencyKey: `${requestId}:discovered`,
    });
    await setMissionStatus(tx, {
      missionId, fromStatus: 'DISCOVERED', toStatus: 'TRIAGED', eventType: 'MISSION_TRIAGED',
      payload: { autonomyLevel, repository, budgetUsd }, idempotencyKey: `${requestId}:triaged`,
    });
    await setMissionStatus(tx, {
      missionId, fromStatus: 'TRIAGED', toStatus: 'READY', eventType: 'MISSION_READY',
      payload: { baseCommit, allowedPaths, acceptanceCriteria }, idempotencyKey: `${requestId}:ready`,
    });
    return { reused: false, missionId, missionHash, status: 'READY' as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

function stringJsonArray(value: Prisma.JsonValue, field: string) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new EngineeringStoreError(`GoalSpec ${field} inválido`, 409, 'INVALID_ENGINEERING_GOAL');
  }
  return value as string[];
}

function fileContainsDesiredState(value: Prisma.JsonValue) {
  const desired = record(value);
  const keys = Object.keys(desired);
  if (keys.length !== 3 || keys.some((key) => !['type', 'path', 'needles'].includes(key))
    || desired.type !== 'FILE_CONTAINS_ALL' || !Array.isArray(desired.needles)
    || desired.needles.length < 2 || desired.needles.length > 20) {
    throw new EngineeringStoreError('Tipo de estado deseado no habilitado', 409, 'INVALID_ENGINEERING_GOAL');
  }
  const needles = desired.needles.map((needle) => text(needle, 500));
  if (new Set(needles).size !== needles.length) {
    throw new EngineeringStoreError('Postcondiciones duplicadas', 409, 'INVALID_ENGINEERING_GOAL');
  }
  return {
    type: 'FILE_CONTAINS_ALL' as const,
    path: safeRelativePath(text(desired.path, 300)),
    needles,
  };
}

function desiredNeedleHashes(desired: { needles: readonly string[] }) {
  return desired.needles.map((needle) => engineeringHash({ needle })).sort();
}

function assertDesiredStateReadback(desiredState: Prisma.JsonValue | null, rawPayload: unknown) {
  if (desiredState === null) return;
  const desired = fileContainsDesiredState(desiredState);
  const payload = record(rawPayload);
  const readback = record(payload.desiredStateReadback);
  const matchedNeedleHashes = Array.isArray(readback.matchedNeedleHashes)
    ? readback.matchedNeedleHashes.filter((item): item is string => typeof item === 'string').sort()
    : [];
  const expectedNeedleHashes = desiredNeedleHashes(desired);
  if (Object.keys(readback).length !== 5
    || Object.keys(readback).some((key) => !['type', 'path', 'matched', 'contentHash', 'matchedNeedleHashes'].includes(key))
    || readback.type !== 'FILE_CONTAINS_ALL'
    || readback.path !== desired.path
    || readback.matched !== true
    || matchedNeedleHashes.length !== expectedNeedleHashes.length
    || matchedNeedleHashes.some((hash, index) => hash !== expectedNeedleHashes[index])
    || typeof readback.contentHash !== 'string'
    || !/^[a-f0-9]{64}$/.test(readback.contentHash)) {
    throw new EngineeringStoreError('Postcondición determinística no comprobada', 409, 'DESIRED_STATE_READBACK_REQUIRED');
  }
}

function engineeringGoalProjection(goal: {
  id: string;
  goalKey: string;
  version: number;
  sourceKind: string;
  sourceRef: string;
  sourceHash: string;
  objective: string;
  repository: string;
  baseBranch: string;
  desiredState: Prisma.JsonValue;
  allowedPaths: Prisma.JsonValue;
  acceptanceCriteria: Prisma.JsonValue;
  autonomyLevel: string;
  budgetUsd: Prisma.Decimal;
  missionTtlMinutes: number;
  policyHash: string;
  priority: number;
}) {
  const allowedPaths = stringJsonArray(goal.allowedPaths, 'allowedPaths').map(safeRelativePath);
  const desiredState = fileContainsDesiredState(goal.desiredState);
  if (!allowedPaths.some((allowed) => desiredState.path === allowed || desiredState.path.startsWith(`${allowed}/`))) {
    throw new EngineeringStoreError('Desired state fuera de allowedPaths', 409, 'INVALID_ENGINEERING_GOAL');
  }
  if (goal.repository !== ALLOWED_REPOSITORY || goal.baseBranch !== 'main'
    || !['A1', 'A2'].includes(goal.autonomyLevel)) {
    throw new EngineeringStoreError('GoalSpec excede la autoridad habilitada', 403, 'ENGINEERING_GOAL_AUTHORITY_DENIED');
  }
  return {
    goalId: goal.id,
    goalKey: opaqueIdentifier(
      goal.goalKey,
      120,
      /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/,
      'goalKey inválido',
      'INVALID_ENGINEERING_GOAL',
    ),
    version: goal.version,
    sourceKind: goal.sourceKind,
    sourceRef: goal.sourceRef,
    sourceHash: goal.sourceHash,
    objective: goal.objective,
    repository: goal.repository,
    baseBranch: goal.baseBranch,
    desiredState,
    allowedPaths,
    acceptanceCriteria: stringJsonArray(goal.acceptanceCriteria, 'acceptanceCriteria'),
    autonomyLevel: goal.autonomyLevel as 'A1' | 'A2',
    budgetUsd: decimalNumber(goal.budgetUsd),
    missionTtlMinutes: goal.missionTtlMinutes,
    policyHash: goal.policyHash,
    priority: goal.priority,
  };
}

const ENGINEERING_GOAL_PAGE_SIZE = 20;

export async function listActiveEngineeringGoals(rawCursor?: unknown) {
  const cursor = rawCursor === undefined || rawCursor === null || rawCursor === ''
    ? null
    : opaqueIdentifier(
      rawCursor,
      180,
      /^[A-Za-z0-9][A-Za-z0-9._:-]{7,179}$/,
      'cursor inválido',
      'INVALID_ENGINEERING_GOAL_CURSOR',
    );
  const goals = await companyOsV3Prisma().companyOsEngineeringGoal.findMany({
    where: { status: 'ACTIVE' },
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
    include: {
      signals: {
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 1,
        select: { id: true },
      },
    },
    take: ENGINEERING_GOAL_PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const page = goals.slice(0, ENGINEERING_GOAL_PAGE_SIZE);
  const projected = [];
  const invalidGoals = [];
  for (const goal of page) {
    try {
      projected.push({
        ...engineeringGoalProjection(goal),
        observationCursor: goal.signals[0]?.id ?? null,
      });
    } catch (error) {
      invalidGoals.push({
        goalId: goal.id,
        code: error instanceof EngineeringStoreError ? error.code : 'INVALID_ENGINEERING_GOAL',
      });
    }
  }
  return {
    goals: projected,
    invalidGoals,
    nextCursor: goals.length > ENGINEERING_GOAL_PAGE_SIZE ? page.at(-1)?.id ?? null : null,
  };
}

function existingGoalSignalDecision(signal: {
  observedSatisfied: boolean;
  observedState: unknown;
  missionId: string | null;
}, mission: { status: string; deadline: Date } | null, now = new Date()) {
  if (signal.observedSatisfied) return 'QUIESCENT' as const;
  if (mission) {
    if (['FAILED_FINAL', 'CANCELLED', 'BLOCKED_INPUT', 'BLOCKED_AUTHORITY'].includes(mission.status)) {
      return 'BLOCKED_FINAL' as const;
    }
    if (mission.deadline <= now) return 'EXPIRED' as const;
    if (['AWAITING_APPROVAL', 'READY_FOR_EFFECT', 'READY_FOR_HUMAN', 'COMPLETED'].includes(mission.status)) {
      return 'AWAITING_HUMAN' as const;
    }
    return 'PENDING' as const;
  }
  return record(signal.observedState).type === 'GOAL_ISSUE' ? 'STALE' as const : 'QUIESCENT' as const;
}

export async function reconcileEngineeringGoalObservation(rawInput: unknown, identity: {
  workerId: string;
  instanceId: string;
}) {
  const input = record(rawInput);
  const goalId = opaqueIdentifier(
    input.goalId,
    180,
    /^[A-Za-z0-9][A-Za-z0-9._:-]{7,179}$/,
    'goalId inválido',
    'INVALID_ENGINEERING_GOAL_ID',
  );
  const baseCommit = opaqueHex(input.baseCommit, 40, 'baseCommit inválido', 'INVALID_BASE_COMMIT');
  const evidenceHash = opaqueHex(input.evidenceHash, 64, 'evidenceHash inválido', 'INVALID_EVIDENCE_HASH');
  if (typeof input.observedSatisfied !== 'boolean') {
    throw new EngineeringStoreError('observedSatisfied inválido', 400, 'INVALID_ENGINEERING_OBSERVATION');
  }
  const observedState = record(input.observedState);
  const expectedObservationCursor = input.expectedObservationCursor === null
    ? null
    : opaqueIdentifier(
      input.expectedObservationCursor,
      200,
      /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/,
      'expectedObservationCursor inválido',
      'INVALID_ENGINEERING_OBSERVATION_CURSOR',
    );
  if (Buffer.byteLength(JSON.stringify(observedState), 'utf8') > GOAL_SIGNAL_MAX_BYTES) {
    throw new EngineeringStoreError('Observación demasiado grande', 413, 'ENGINEERING_OBSERVATION_TOO_LARGE');
  }
  const db = companyOsV3Prisma();
  const goalRow = await db.companyOsEngineeringGoal.findUnique({ where: { id: goalId } });
  if (!goalRow || goalRow.status !== 'ACTIVE') {
    throw new EngineeringStoreError('GoalSpec no activo', 409, 'ENGINEERING_GOAL_NOT_ACTIVE');
  }
  const goal = engineeringGoalProjection(goalRow);
  const observedKeys = Object.keys(observedState);
  const isGoalIssue = observedState.type === 'GOAL_ISSUE';
  const validGoalIssue = isGoalIssue
    && input.observedSatisfied === false
    && observedKeys.every((key) => ['type', 'code', 'sourceRef', 'actualHash'].includes(key))
    && observedState.code === 'SOURCE_HASH_MISMATCH'
    && observedState.sourceRef === goal.sourceRef
    && typeof observedState.actualHash === 'string'
    && /^[a-f0-9]{64}$/.test(observedState.actualHash);
  const expectedNeedleHashes = desiredNeedleHashes(goal.desiredState);
  const matchedNeedleHashes = Array.isArray(observedState.matchedNeedleHashes)
    ? observedState.matchedNeedleHashes.filter((item): item is string => typeof item === 'string').sort()
    : [];
  const validDesiredState = !isGoalIssue
    && observedKeys.length === 6
    && observedKeys.every((key) => ['type', 'path', 'fileExists', 'matched', 'contentHash', 'matchedNeedleHashes'].includes(key))
    && observedState.type === 'FILE_CONTAINS_ALL'
    && observedState.path === goal.desiredState.path
    && typeof observedState.fileExists === 'boolean'
    && typeof observedState.matched === 'boolean'
    && observedState.matched === input.observedSatisfied
    && matchedNeedleHashes.length === new Set(matchedNeedleHashes).size
    && matchedNeedleHashes.every((hash) => expectedNeedleHashes.includes(hash))
    && input.observedSatisfied === (matchedNeedleHashes.length === expectedNeedleHashes.length)
    && (observedState.matched !== true || observedState.fileExists === true)
    && (observedState.fileExists === true
      ? typeof observedState.contentHash === 'string' && /^[a-f0-9]{64}$/.test(observedState.contentHash)
      : observedState.matched === false && observedState.contentHash === null);
  if (!validGoalIssue && !validDesiredState) {
    throw new EngineeringStoreError('Observación no coincide con el contrato', 400, 'INVALID_ENGINEERING_OBSERVATION');
  }
  const computedEvidenceHash = engineeringHash({
    goalId,
    baseCommit,
    observedSatisfied: input.observedSatisfied,
    observedState,
  });
  if (computedEvidenceHash !== evidenceHash) {
    throw new EngineeringStoreError('Hash de evidencia no coincide', 409, 'ENGINEERING_EVIDENCE_HASH_MISMATCH');
  }
  return db.$transaction(async (tx) => {
    const activeGoalRow = await tx.companyOsEngineeringGoal.findUnique({ where: { id: goalId } });
    if (!activeGoalRow || activeGoalRow.status !== 'ACTIVE') {
      throw new EngineeringStoreError('GoalSpec no activo', 409, 'ENGINEERING_GOAL_NOT_ACTIVE');
    }
    engineeringGoalProjection(activeGoalRow);
    const latestSatisfiedSignal = await tx.companyOsEngineeringGoalSignal.findFirst({
      where: { goalId, observedSatisfied: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const observationEpoch = !input.observedSatisfied && !isGoalIssue
      ? latestSatisfiedSignal
        ? engineeringHash({ goalId, satisfiedSignalId: latestSatisfiedSignal.id }).slice(0, 16)
        : 'initial'
      : null;
    // Bind idempotency to the exact predecessor. An HTTP retry reuses the same
    // signal, while a later A -> B -> A observation appends a new latest signal
    // instead of resurrecting stale authority from the first A.
    const idempotencyKey = `goal-signal:${engineeringHash({
      computedEvidenceHash,
      expectedObservationCursor,
    })}`;
    const existingSignal = await tx.companyOsEngineeringGoalSignal.findUnique({ where: { idempotencyKey } });
    if (existingSignal) {
      const existingMission = existingSignal.missionId
        ? await tx.companyOsEngineeringMission.findUnique({ where: { id: existingSignal.missionId } })
        : null;
      return {
        reused: true,
        missionReused: existingSignal.missionId !== null,
        decision: existingGoalSignalDecision(existingSignal, existingMission),
        signalId: existingSignal.id,
        missionId: existingSignal.missionId,
      };
    }
    const latestSignal = await tx.companyOsEngineeringGoalSignal.findFirst({
      where: { goalId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    if ((latestSignal?.id ?? null) !== expectedObservationCursor) {
      throw new EngineeringStoreError(
        'La observación partió de un estado anterior del GoalSpec',
        409,
        'ENGINEERING_OBSERVATION_STALE',
      );
    }
    if (latestSignal
      && latestSignal.evidenceHash === computedEvidenceHash
      && latestSignal.baseCommit === baseCommit
      && latestSignal.observedSatisfied === input.observedSatisfied
      && engineeringHash(latestSignal.observedState) === engineeringHash(observedState)) {
      const existingMission = latestSignal.missionId
        ? await tx.companyOsEngineeringMission.findUnique({ where: { id: latestSignal.missionId } })
        : null;
      return {
        reused: true,
        missionReused: latestSignal.missionId !== null,
        decision: existingGoalSignalDecision(latestSignal, existingMission),
        signalId: latestSignal.id,
        missionId: latestSignal.missionId,
      };
    }

    let mission = !input.observedSatisfied && !isGoalIssue
      ? await tx.companyOsEngineeringMission.findFirst({
        where: { goalId, status: { notIn: ['COMPLETED', 'FAILED_FINAL', 'CANCELLED'] } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      })
      : null;
    const latestTerminalMission = !input.observedSatisfied && !isGoalIssue && !mission
      ? await tx.companyOsEngineeringMission.findFirst({
        where: { goalId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      })
      : null;
    // A satisfaction signal opens the next observation epoch even if the
    // previous mission only becomes terminal afterwards (for example after its
    // active lease notices that authority was revoked). Comparing with mission
    // creation prevents an older satisfied epoch from reopening a newer
    // terminal mission indefinitely.
    const terminalEpochStartedAt = latestTerminalMission?.createdAt ?? null;
    const resetObserved = engineeringGoalEpochResetObserved(
      latestSatisfiedSignal?.createdAt ?? null,
      terminalEpochStartedAt,
    );
    if (!mission && latestTerminalMission && !resetObserved) mission = latestTerminalMission;
    const missionReused = mission !== null;
    let missionCreated = false;
    if (!input.observedSatisfied && !isGoalIssue && (!latestTerminalMission || resetObserved) && !mission) {
      if (observationEpoch === null) {
        throw new EngineeringStoreError('Epoch de observación ausente', 409, 'ENGINEERING_OBSERVATION_EPOCH_MISSING');
      }
      await requireControlAllows(tx, { repository: goal.repository, actor: ENGINEERING_ACTOR, intake: true });
      const missionId = `engineering-mission:${randomUUID()}`;
      const requestId = engineeringGoalRequestId({
        goalId,
        goalKey: goal.goalKey,
        version: goal.version,
        baseCommit,
        evidenceHash,
        observationEpoch,
      });
      const objective = text(
        `${goal.objective}\n\nGoalSpec: ${goal.goalKey}@${goal.version}; source=${goal.sourceRef}; evidenceHash=${evidenceHash}.`,
        MAX_OBJECTIVE_LENGTH,
      );
      const deadline = new Date(Date.now() + goal.missionTtlMinutes * 60_000);
      const contract: EngineeringMissionContract = {
        contractVersion: ENGINEERING_V2_CONTRACT_VERSION,
        missionId,
        objective,
        repository: goal.repository,
        baseCommit,
        allowedPaths: goal.allowedPaths,
        acceptanceCriteria: goal.acceptanceCriteria,
        desiredState: goal.desiredState,
        autonomyLevel: goal.autonomyLevel,
        budgetUsd: goal.budgetUsd,
        deadline: deadline.toISOString(),
        policyHash: goal.policyHash,
        expectedStateVersion: 1,
      };
      const missionHash = engineeringMissionHash(contract);
      mission = await tx.companyOsEngineeringMission.create({ data: {
        id: missionId,
        goalId,
        requestId,
        missionHash,
        contractVersion: ENGINEERING_V2_CONTRACT_VERSION,
        objective,
        repository: goal.repository,
        baseCommit,
        allowedPaths: jsonValue(goal.allowedPaths),
        acceptanceCriteria: jsonValue(goal.acceptanceCriteria),
        desiredState: jsonValue(goal.desiredState),
        autonomyLevel: goal.autonomyLevel,
        budgetUsd: goal.budgetUsd,
        deadline,
        policyHash: goal.policyHash,
        stateVersion: 1,
        status: 'DISCOVERED',
      } });
      const actorRef = `goal-reconciler:${identity.workerId}`;
      await appendEvent(tx, {
        missionId,
        eventType: 'MISSION_DISCOVERED',
        fromStatus: null,
        toStatus: 'DISCOVERED',
        payload: { requestId, missionHash, actorRef, goalId, evidenceHash },
        idempotencyKey: `${requestId}:discovered`,
      });
      await setMissionStatus(tx, {
        missionId,
        fromStatus: 'DISCOVERED',
        toStatus: 'TRIAGED',
        eventType: 'MISSION_TRIAGED',
        payload: { autonomyLevel: goal.autonomyLevel, repository: goal.repository, budgetUsd: goal.budgetUsd },
        idempotencyKey: `${requestId}:triaged`,
      });
      await setMissionStatus(tx, {
        missionId,
        fromStatus: 'TRIAGED',
        toStatus: 'READY',
        eventType: 'MISSION_READY',
        payload: { baseCommit, allowedPaths: goal.allowedPaths, acceptanceCriteria: goal.acceptanceCriteria },
        idempotencyKey: `${requestId}:ready`,
      });
      missionCreated = true;
    }

    const signal = await tx.companyOsEngineeringGoalSignal.create({ data: {
      id: `engineering-goal-signal:${randomUUID()}`,
      goalId,
      workerId: identity.workerId,
      instanceId: identity.instanceId,
      baseCommit,
      observedSatisfied: input.observedSatisfied as boolean,
      observedState: jsonValue(observedState),
      evidenceHash,
      idempotencyKey,
      missionId: mission?.id ?? null,
    } });
    return {
      reused: false,
      missionReused,
      decision: input.observedSatisfied ? 'QUIESCENT' as const
        : isGoalIssue ? 'STALE' as const
          : missionCreated ? 'MATERIALIZED' as const : existingGoalSignalDecision({
            observedSatisfied: false,
            observedState: jsonValue(observedState),
            missionId: mission?.id ?? null,
          }, mission),
      signalId: signal.id,
      missionId: mission?.id ?? null,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

function engineeringRetryDisposition(mission: {
  attemptCount: number;
  maxAttempts: number;
  deadline: Date;
}, requestedRetry: boolean, now = new Date()) {
  const backoffMs = Math.min(
    ENGINEERING_RETRY_MAX_MS,
    ENGINEERING_RETRY_BASE_MS * (2 ** Math.max(0, mission.attemptCount - 1)),
  );
  const nextAttemptAt = new Date(now.getTime() + backoffMs);
  const retryable = requestedRetry
    && mission.attemptCount < mission.maxAttempts
    && nextAttemptAt < mission.deadline;
  return { retryable, nextAttemptAt, backoffMs };
}

async function transitionEngineeringFailure(tx: Tx, input: {
  mission: {
    id: string;
    status: string;
    attemptCount: number;
    maxAttempts: number;
    deadline: Date;
  };
  errorCode: string;
  requestedRetry: boolean;
  idempotencyKey: string;
  eventType?: string;
  payload?: Record<string, unknown>;
  fencingToken?: bigint | null;
}) {
  const disposition = engineeringRetryDisposition(input.mission, input.requestedRetry);
  const toStatus: EngineeringMissionState = disposition.retryable ? 'FAILED_RETRYABLE' : 'FAILED_FINAL';
  await setMissionStatus(tx, {
    missionId: input.mission.id,
    fromStatus: input.mission.status as EngineeringMissionState,
    toStatus,
    eventType: input.eventType ?? 'ENGINEERING_MISSION_FAILED',
    payload: {
      ...(input.payload ?? {}),
      errorCode: input.errorCode,
      requestedRetry: input.requestedRetry,
      retryable: disposition.retryable,
      attemptCount: input.mission.attemptCount,
      maxAttempts: input.mission.maxAttempts,
      backoffMs: disposition.retryable ? disposition.backoffMs : 0,
    },
    idempotencyKey: input.idempotencyKey,
    fencingToken: input.fencingToken,
  });
  if (disposition.retryable) {
    await tx.companyOsEngineeringMission.update({
      where: { id: input.mission.id },
      data: { nextAttemptAt: disposition.nextAttemptAt },
    });
  }
  return { status: toStatus, retryable: disposition.retryable, nextAttemptAt: disposition.retryable ? disposition.nextAttemptAt : null };
}

async function finalizeExhaustedEngineeringMissions(tx: Tx) {
  const exhausted = await tx.$queryRaw<Array<{
    id: string;
    status: string;
    attemptCount: number;
    maxAttempts: number;
    deadline: Date;
  }>>(Prisma.sql`
    SELECT id, status, "attemptCount", "maxAttempts", deadline
    FROM public."CompanyOsEngineeringMission"
    WHERE status IN ('READY','FAILED_RETRYABLE','READY_FOR_EFFECT')
      AND (deadline <= now() OR "attemptCount" >= "maxAttempts")
      AND NOT EXISTS (
        SELECT 1
        FROM public."CompanyOsEngineeringCapabilityLease" lease
        WHERE lease."missionId" = "CompanyOsEngineeringMission".id
          AND lease.status = 'ACTIVE'
          AND lease."expiresAt" > now()
      )
    FOR UPDATE SKIP LOCKED
  `);
  for (const mission of exhausted) {
    if (mission.status === 'READY_FOR_EFFECT') {
      await tx.companyOsEngineeringEffect.updateMany({
        where: { missionId: mission.id, status: 'DISPATCHING' },
        data: { status: 'UNKNOWN_OUTCOME', lastErrorCode: 'RETRY_BUDGET_EXHAUSTED_DURING_EFFECT' },
      });
      await tx.companyOsEngineeringEffect.updateMany({
        where: { missionId: mission.id, status: { in: ['PLANNED', 'RESERVED'] } },
        data: { status: 'FAILED', lastErrorCode: 'RETRY_BUDGET_EXHAUSTED_BEFORE_DISPATCH' },
      });
      const unknownEffects = await tx.companyOsEngineeringEffect.count({
        where: { missionId: mission.id, status: 'UNKNOWN_OUTCOME' },
      });
      // Unknown external outcomes are a safety duty, not execution work. Keep
      // the mission reconcilable beyond its normal attempt/deadline budget.
      if (unknownEffects > 0) continue;
    }
    await setMissionStatus(tx, {
      missionId: mission.id,
      fromStatus: mission.status as EngineeringMissionState,
      toStatus: 'FAILED_FINAL',
      eventType: 'ENGINEERING_RETRY_BUDGET_EXHAUSTED',
      payload: { attemptCount: mission.attemptCount, maxAttempts: mission.maxAttempts, deadline: mission.deadline.toISOString() },
      idempotencyKey: `retry-budget-exhausted:${mission.id}:${mission.attemptCount}`,
    });
  }
}

async function recoverExpiredEngineeringLeases(tx: Tx) {
  const now = new Date();
  const expired = await tx.companyOsEngineeringCapabilityLease.findMany({
    where: { status: 'ACTIVE', expiresAt: { lte: now } }, select: { id: true, missionId: true, fencingToken: true },
  });
  for (const lease of expired) {
    await tx.companyOsEngineeringEffect.updateMany({
      where: { capabilityLeaseId: lease.id, status: 'DISPATCHING' },
      data: { status: 'UNKNOWN_OUTCOME', lastErrorCode: 'LEASE_EXPIRED_DURING_EFFECT' },
    });
    await tx.companyOsEngineeringCapabilityLease.updateMany({
      where: { id: lease.id, status: 'ACTIVE' }, data: { status: 'EXPIRED', revokedAt: now },
    });
    const mission = await tx.companyOsEngineeringMission.findUnique({ where: { id: lease.missionId } });
    if (mission?.status === 'READY_FOR_EFFECT') {
      const effects = await tx.companyOsEngineeringEffect.count({ where: { missionId: mission.id } });
      if (effects === 0) {
        await transitionEngineeringFailure(tx, {
          mission,
          errorCode: 'LEASE_EXPIRED_BEFORE_EFFECT_RESERVATION',
          requestedRetry: true,
          eventType: 'LEASE_EXPIRED_RECOVERY',
          payload: { expiredLeaseId: lease.id, externalEffects: 0 },
          idempotencyKey: `lease-expired-before-effect:${lease.id}`,
          fencingToken: lease.fencingToken,
        });
      }
      continue;
    }
    if (!mission || !ACTIVE_MISSION_STATES.includes(mission.status as typeof ACTIVE_MISSION_STATES[number])) continue;
    await transitionEngineeringFailure(tx, {
      mission,
      errorCode: 'LEASE_EXPIRED_RECOVERY',
      requestedRetry: true,
      eventType: 'LEASE_EXPIRED_RECOVERY',
      payload: { expiredLeaseId: lease.id },
      idempotencyKey: `lease-expired:${lease.id}`,
      fencingToken: lease.fencingToken,
    });
  }
}

async function recoverOrphanedEngineeringMissions(tx: Tx) {
  const readyForHuman = await tx.companyOsEngineeringMission.findMany({
    where: {
      status: 'READY_FOR_HUMAN',
      capabilityLeases: { none: { status: 'ACTIVE' } },
    },
    include: {
      effects: true,
      events: {
        where: { eventType: { in: ['ENGINEERING_READY_FOR_EFFECT', 'ENGINEERING_READY_FOR_HUMAN'] } },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });
  for (const mission of readyForHuman) {
    const effectsSettled = mission.effects.every((effect) => ['CONFIRMED', 'FAILED'].includes(effect.status));
    const pushConfirmed = mission.effects.some((effect) => effect.verb === 'PUSH_BRANCH' && effect.status === 'CONFIRMED');
    const draftConfirmed = mission.effects.some((effect) => effect.verb === 'CREATE_DRAFT_PR' && effect.status === 'CONFIRMED');
    if (!effectsSettled || (mission.autonomyLevel === 'A2' && (!pushConfirmed || !draftConfirmed))) continue;
    try { assertDesiredStateReadback(mission.desiredState, mission.events[0]?.payload); } catch { continue; }
    await setMissionStatus(tx, {
      missionId: mission.id,
      fromStatus: 'READY_FOR_HUMAN',
      toStatus: 'COMPLETED',
      eventType: 'ORPHANED_COMPLETION_RECOVERY',
      payload: {
        effectsConfirmed: mission.effects.filter((effect) => effect.status === 'CONFIRMED').length,
        autonomyLevel: mission.autonomyLevel,
      },
      idempotencyKey: `orphaned-completion:${mission.id}:${mission.fencingCounter.toString()}`,
      fencingToken: mission.fencingCounter > BigInt(0) ? mission.fencingCounter : null,
      completedAt: new Date(),
    });
  }
  const orphanedEffectMissions = await tx.companyOsEngineeringMission.findMany({
    where: {
      capabilityLeases: { none: { status: 'ACTIVE' } },
      effects: { some: { status: 'DISPATCHING' } },
    },
    select: { id: true },
  });
  for (const mission of orphanedEffectMissions) {
    await tx.companyOsEngineeringEffect.updateMany({
      where: { missionId: mission.id, status: 'DISPATCHING' },
      data: { status: 'UNKNOWN_OUTCOME', lastErrorCode: 'ORPHANED_LEASE_DURING_EFFECT' },
    });
  }
  const orphanedReadyForEffectWithoutEffects = await tx.companyOsEngineeringMission.findMany({
    where: {
      status: 'READY_FOR_EFFECT',
      capabilityLeases: { none: { status: 'ACTIVE' } },
      effects: { none: {} },
    },
  });
  for (const mission of orphanedReadyForEffectWithoutEffects) {
    await transitionEngineeringFailure(tx, {
      mission,
      errorCode: 'ORPHANED_BEFORE_EFFECT_RESERVATION',
      requestedRetry: true,
      eventType: 'ORPHANED_LEASE_RECOVERY',
      payload: { fencingToken: mission.fencingCounter.toString(), externalEffects: 0 },
      idempotencyKey: `orphaned-before-effect:${mission.id}:${mission.fencingCounter.toString()}`,
      fencingToken: mission.fencingCounter > BigInt(0) ? mission.fencingCounter : null,
    });
  }
  const orphaned = await tx.companyOsEngineeringMission.findMany({
    where: {
      status: { in: [...ACTIVE_MISSION_STATES] },
      capabilityLeases: { none: { status: 'ACTIVE' } },
    },
  });
  for (const mission of orphaned) {
    await transitionEngineeringFailure(tx, {
      mission,
      errorCode: 'ORPHANED_LEASE_RECOVERY',
      requestedRetry: true,
      eventType: 'ORPHANED_LEASE_RECOVERY',
      payload: { fencingToken: mission.fencingCounter.toString() },
      idempotencyKey: `orphaned-lease:${mission.id}:${mission.fencingCounter.toString()}`,
      fencingToken: mission.fencingCounter > BigInt(0) ? mission.fencingCounter : null,
    });
  }
}

export async function claimEngineeringMission(input: { workerId: string; instanceId: string }) {
  const db = companyOsV3Prisma();
  return db.$transaction(async (tx) => {
    await recoverExpiredEngineeringLeases(tx);
    await recoverOrphanedEngineeringMissions(tx);
    await finalizeExhaustedEngineeringMissions(tx);
    const control = await tx.companyOsEngineeringControl.findUniqueOrThrow({ where: { id: ENGINEERING_CONTROL_ID } });
    if (control.pauseExecution || control.emergencyStop || control.disabledActors.includes(ENGINEERING_ACTOR)) return null;
    const candidates = await tx.$queryRaw<Array<{ id: string; mode: 'EXECUTE' | 'RECONCILE' }>>(Prisma.sql`
      SELECT mission.id,
        CASE WHEN mission.status = 'READY_FOR_EFFECT' THEN 'RECONCILE' ELSE 'EXECUTE' END AS mode
      FROM public."CompanyOsEngineeringMission" mission
      WHERE (
          (
            mission.status = 'READY_FOR_EFFECT'
            AND EXISTS (
              SELECT 1 FROM public."CompanyOsEngineeringEffect" effect
              WHERE effect."missionId" = mission.id
            )
          )
          OR (
            mission.status IN ('READY','FAILED_RETRYABLE','READY_FOR_EFFECT')
            AND mission.deadline > now()
            AND mission."attemptCount" < mission."maxAttempts"
            AND mission."nextAttemptAt" <= now()
            AND (
              mission."goalId" IS NULL
              OR EXISTS (
                SELECT 1
                FROM public."CompanyOsEngineeringGoal" goal
                WHERE goal.id = mission."goalId"
                  AND goal.status = 'ACTIVE'
                  AND EXISTS (
                    SELECT 1
                    FROM public."CompanyOsEngineeringGoalSignal" signal
                    WHERE signal."goalId" = goal.id
                      AND signal."observedSatisfied" = false
                      AND COALESCE(signal."observedState"->>'type', '') <> 'GOAL_ISSUE'
                      AND signal.id = (
                        SELECT latest.id
                        FROM public."CompanyOsEngineeringGoalSignal" latest
                        WHERE latest."goalId" = goal.id
                        ORDER BY latest."createdAt" DESC, latest.id DESC
                        LIMIT 1
                      )
                  )
              )
            )
          )
        )
        AND mission.repository <> ALL(${control.quarantinedRepositories}::text[])
        AND NOT EXISTS (
          SELECT 1 FROM public."CompanyOsEngineeringCapabilityLease" lease
          WHERE lease."missionId" = mission.id AND lease.status = 'ACTIVE' AND lease."expiresAt" > now()
        )
      ORDER BY mission."createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);
    if (!candidates[0]) return null;
    let mission = await tx.companyOsEngineeringMission.findUniqueOrThrow({ where: { id: candidates[0].id } });
    const mode = candidates[0].mode;
    const existingEffects = mode === 'RECONCILE'
      ? await tx.companyOsEngineeringEffect.count({ where: { missionId: mission.id } })
      : 0;
    const unknownEffects = mode === 'RECONCILE'
      ? await tx.companyOsEngineeringEffect.count({ where: { missionId: mission.id, status: 'UNKNOWN_OUTCOME' } })
      : 0;
    let reconciliationOnly = mode === 'RECONCILE'
      && unknownEffects > 0
      && (mission.deadline <= new Date() || mission.attemptCount >= mission.maxAttempts);
    try {
      await requireGoalAllowsMission(tx, mission);
    } catch (error) {
      if (mode !== 'RECONCILE' || existingEffects === 0) throw error;
      reconciliationOnly = true;
    }
    if (mission.status === 'FAILED_RETRYABLE') {
      await setMissionStatus(tx, {
        missionId: mission.id, fromStatus: 'FAILED_RETRYABLE', toStatus: 'READY', eventType: 'MISSION_REQUEUED',
        payload: { workerId: input.workerId }, idempotencyKey: `requeue:${mission.fencingCounter.toString()}:${mission.id}`,
      });
      mission = await tx.companyOsEngineeringMission.findUniqueOrThrow({ where: { id: mission.id } });
    }
    if (mode === 'EXECUTE') {
      mission = await tx.companyOsEngineeringMission.update({
        where: { id: mission.id },
        data: { attemptCount: { increment: 1 } },
      });
    }
    await requireControlAllows(tx, { repository: mission.repository, actor: ENGINEERING_ACTOR });
    const fencingToken = mission.fencingCounter + BigInt(1);
    const leaseId = `engineering-lease:${randomUUID()}`;
    const [databaseClock] = await tx.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT now() AS now`);
    if (!databaseClock?.now) throw new EngineeringStoreError('Reloj autoritativo no observado', 503, 'DATABASE_CLOCK_UNOBSERVED');
    const issuedAt = databaseClock.now;
    const expiresAt = new Date(issuedAt.getTime() + ACTIVE_LEASE_MS);
    const allowedVerbs = reconciliationOnly
      ? ['READ_REPOSITORY']
      : mission.autonomyLevel === 'A2' ? [...A2_VERBS] : [...A1_VERBS];
    const lease = await tx.companyOsEngineeringCapabilityLease.create({ data: {
      id: leaseId, missionId: mission.id, missionHash: mission.missionHash, actor: ENGINEERING_ACTOR,
      resource: mission.repository, allowedVerbs: jsonValue(allowedVerbs), allowedPaths: jsonValue(mission.allowedPaths),
      autonomyLevel: mission.autonomyLevel, budgetUsd: mission.budgetUsd, policyHash: mission.policyHash,
      fencingToken, expectedStateVersion: mission.stateVersion, status: 'ACTIVE', issuedAt, expiresAt,
    } });
    const issuedFencingToken = lease.fencingToken;
    if (mode === 'EXECUTE') {
      await setMissionStatus(tx, {
        missionId: mission.id, fromStatus: 'READY', toStatus: 'LEASED', eventType: 'CAPABILITY_LEASE_ISSUED',
        payload: {
          leaseId,
          workerId: input.workerId,
          instanceId: input.instanceId,
          fencingToken: issuedFencingToken.toString(),
          attemptCount: mission.attemptCount,
          maxAttempts: mission.maxAttempts,
        },
        idempotencyKey: `lease-issued:${leaseId}`, fencingToken: issuedFencingToken,
      });
    }
    const contract = missionContract(mission);
    const reconciliationEffects = mode === 'RECONCILE'
      ? await tx.companyOsEngineeringEffect.findMany({
        where: { missionId: mission.id }, orderBy: { createdAt: 'asc' },
      })
      : [];
    return {
      mode,
      reconciliationOnly,
      mission: contract,
      lease: {
        leaseId: lease.id, missionId: mission.id, missionHash: mission.missionHash, actor: lease.actor,
        resource: lease.resource, allowedVerbs, allowedPaths: contract.allowedPaths,
        autonomyLevel: lease.autonomyLevel, budgetUsd: decimalNumber(lease.budgetUsd), policyHash: lease.policyHash,
        fencingToken: Number(issuedFencingToken), expectedStateVersion: lease.expectedStateVersion,
        issuedAt: lease.issuedAt.toISOString(), expiresAt: lease.expiresAt.toISOString(),
      },
      effects: reconciliationEffects.map((effect) => ({
        effectId: effect.id,
        verb: effect.verb,
        status: effect.status,
        targetRepository: effect.targetRepository,
        targetBaseBranch: effect.targetBaseBranch,
        targetHeadBranch: effect.targetHeadBranch,
        targetCommitSha: effect.targetCommitSha,
        idempotencyKey: effect.idempotencyKey,
      })),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function heartbeatEngineeringMission(input: {
  missionId: string; leaseId: string; fencingToken: bigint; phase?: string;
}) {
  const db = companyOsV3Prisma();
  return db.$transaction(async (tx) => {
    const { mission, lease } = await requireLease(tx, input);
    const expiresAt = new Date(Date.now() + ACTIVE_LEASE_MS);
    await tx.companyOsEngineeringCapabilityLease.update({ where: { id: lease.id }, data: { expiresAt } });
    if (mission.status === 'LEASED') {
      await setMissionStatus(tx, {
        missionId: mission.id, fromStatus: 'LEASED', toStatus: 'RUNNING', eventType: 'ENGINEERING_WORK_STARTED',
        payload: { phase: text(input.phase ?? 'RUNNING', 80) }, idempotencyKey: `work-started:${lease.id}`,
        fencingToken: lease.fencingToken,
      });
    }
    return { renewed: true, leaseExpiresAt: expiresAt.toISOString(), stopRequested: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function recordStaleFencingRejection(input: {
  missionId: string; leaseId: string; fencingToken: bigint;
}) {
  const db = companyOsV3Prisma();
  return db.$transaction(async (tx) => {
    const mission = await tx.companyOsEngineeringMission.findUnique({ where: { id: input.missionId } });
    if (!mission) return { recorded: false };
    const status = mission.status as EngineeringMissionState;
    const rejectionHash = engineeringHash({ leaseId: input.leaseId, fencingToken: input.fencingToken.toString() });
    await appendEvent(tx, {
      missionId: mission.id,
      eventType: 'STALE_FENCE_REJECTED',
      fromStatus: status,
      toStatus: status,
      payload: { rejectionHash },
      idempotencyKey: `stale-fence:${rejectionHash}`,
      fencingToken: mission.fencingCounter > BigInt(0) ? mission.fencingCounter : null,
    });
    return { recorded: true };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function reconcileEngineeringEffect(input: {
  missionId: string;
  leaseId: string;
  fencingToken: bigint;
  effectId: string;
  outcome: 'CONFIRMED' | 'FAILED';
  remoteProvider?: string;
  remoteId?: string;
  remoteUrl?: string;
  remoteReadback?: unknown;
  errorCode?: string;
}) {
  const db = companyOsV3Prisma();
  return db.$transaction(async (tx) => {
    const { mission, lease } = await requireLease(tx, { ...input, allowExpiredMission: true, allowGoalRevoked: true });
    if (mission.status !== 'READY_FOR_EFFECT') {
      throw new EngineeringStoreError('Misión no está reconciliando efectos', 409, 'MISSION_STATE_CONFLICT');
    }
    const effect = await tx.companyOsEngineeringEffect.findUniqueOrThrow({ where: { id: input.effectId } });
    if (effect.missionId !== mission.id || effect.status !== 'UNKNOWN_OUTCOME') {
      throw new EngineeringStoreError('Efecto no reconciliable', 409, 'EFFECT_STATE_CONFLICT');
    }
    if (input.outcome === 'FAILED') {
      await tx.companyOsEngineeringEffect.update({ where: { id: effect.id }, data: {
        status: 'FAILED', reconciledAt: new Date(), lastErrorCode: text(input.errorCode ?? 'REMOTE_NOT_FOUND_AFTER_READBACK', 80),
      } });
      return { status: 'FAILED' as const, retryDispatch: false };
    }
    const { remoteProvider, remoteId, remoteUrl, remoteReadbackHash } = validateEngineeringRemoteReadback(effect, input);
    await tx.companyOsEngineeringEffect.update({ where: { id: effect.id }, data: {
      status: 'CONFIRMED', remoteProvider, remoteId, remoteUrl, remoteReadbackHash,
      confirmedAt: new Date(), reconciledAt: new Date(),
    } });
    await appendEvent(tx, {
      missionId: mission.id, eventType: 'UNKNOWN_OUTCOME_RECONCILED',
      fromStatus: 'READY_FOR_EFFECT', toStatus: 'READY_FOR_EFFECT',
      payload: { effectId: effect.id, reconciled: true, remoteProvider, remoteId, remoteReadbackHash },
      idempotencyKey: `effect-reconciled:${effect.id}`, fencingToken: lease.fencingToken,
    });
    return { status: 'CONFIRMED' as const, retryDispatch: false, remoteId, remoteUrl };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function transitionEngineeringMission(input: {
  missionId: string; leaseId: string; fencingToken: bigint; toStatus: EngineeringMissionState;
  eventType: string; payload: unknown; idempotencyKey: string;
}) {
  const db = companyOsV3Prisma();
  return db.$transaction(async (tx) => {
    const { mission, lease } = await requireLease(tx, input);
    const fromStatus = mission.status as EngineeringMissionState;
    if (fromStatus === input.toStatus) {
      const prior = await tx.companyOsEngineeringEvent.findUnique({
        where: { missionId_idempotencyKey: { missionId: mission.id, idempotencyKey: input.idempotencyKey } },
      });
      if (prior) return { reused: true, status: mission.status };
    }
    if (['READY_FOR_EFFECT', 'READY_FOR_HUMAN'].includes(input.toStatus)) {
      assertDesiredStateReadback(mission.desiredState, input.payload);
    }
    await setMissionStatus(tx, {
      missionId: mission.id, fromStatus, toStatus: input.toStatus, eventType: text(input.eventType, 100),
      payload: input.payload, idempotencyKey: text(input.idempotencyKey, 180), fencingToken: lease.fencingToken,
    });
    return { reused: false, status: input.toStatus };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

function validateEffectInput(input: Record<string, unknown>) {
  const verb = input.verb === 'PUSH_BRANCH' || input.verb === 'CREATE_DRAFT_PR' ? input.verb : null;
  if (!verb) throw new EngineeringStoreError('Efecto no permitido', 403, 'PRODUCTION_EFFECT_DENIED');
  const targetRepository = text(input.targetRepository, 200);
  if (targetRepository !== ALLOWED_REPOSITORY) throw new EngineeringStoreError('Repositorio no allowlisted', 403, 'TARGET_NOT_ALLOWLISTED');
  const targetBaseBranch = text(input.targetBaseBranch, 160);
  const targetHeadBranch = text(input.targetHeadBranch, 200);
  const targetCommitSha = text(input.targetCommitSha, 64).toLowerCase();
  if (targetBaseBranch !== 'main' || !/^codex\/engineering-v2-[a-z0-9-]{8,80}$/.test(targetHeadBranch)
    || !/^[a-f0-9]{40}$/.test(targetCommitSha)) {
    throw new EngineeringStoreError('Destino GitHub fuera de policy', 403, 'GITHUB_SCOPE_DENIED');
  }
  return { verb, targetRepository, targetBaseBranch, targetHeadBranch, targetCommitSha };
}

function exactObjectKeys(value: unknown, expected: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value as Record<string, unknown>).sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === [...expected].sort()[index]);
}

export function validateEngineeringRemoteReadback(effect: {
  verb: string;
  targetRepository: string;
  targetHeadBranch: string;
  targetCommitSha: string;
}, input: {
  remoteProvider?: unknown;
  remoteId?: unknown;
  remoteUrl?: unknown;
  remoteReadback?: unknown;
}) {
  const remoteProvider = text(input.remoteProvider, 80);
  const remoteId = text(input.remoteId, 200);
  const remoteUrl = text(input.remoteUrl, 500);
  if (remoteProvider !== 'github') {
    throw new EngineeringStoreError('Proveedor remoto inválido', 409, 'REMOTE_READBACK_INVALID');
  }
  let parsedUrl: URL;
  try { parsedUrl = new URL(remoteUrl); } catch {
    throw new EngineeringStoreError('URL remota inválida', 409, 'REMOTE_READBACK_INVALID');
  }
  if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== 'github.com' || parsedUrl.port
    || parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) {
    throw new EngineeringStoreError('URL remota fuera de policy', 409, 'REMOTE_READBACK_INVALID');
  }
  const readback = input.remoteReadback as Record<string, unknown>;
  if (effect.verb === 'PUSH_BRANCH') {
    const expectedUrl = `https://github.com/${effect.targetRepository}/tree/${effect.targetHeadBranch}`;
    if (remoteId !== effect.targetHeadBranch || remoteUrl !== expectedUrl
      || !exactObjectKeys(readback, ['branch', 'commitSha'])
      || readback.branch !== effect.targetHeadBranch || readback.commitSha !== effect.targetCommitSha) {
      throw new EngineeringStoreError('Readback de branch no coincide con el efecto', 409, 'REMOTE_READBACK_CONFLICT');
    }
  } else if (effect.verb === 'CREATE_DRAFT_PR') {
    if (!/^[1-9][0-9]*$/.test(remoteId)) {
      throw new EngineeringStoreError('PR remoto inválido', 409, 'REMOTE_READBACK_INVALID');
    }
    const prNumber = Number(remoteId);
    const expectedUrl = `https://github.com/${effect.targetRepository}/pull/${remoteId}`;
    if (!Number.isSafeInteger(prNumber) || remoteUrl !== expectedUrl
      || !exactObjectKeys(readback, ['number', 'url', 'isDraft', 'branch', 'commitSha'])
      || readback.number !== prNumber || readback.url !== expectedUrl || readback.isDraft !== true
      || readback.branch !== effect.targetHeadBranch || readback.commitSha !== effect.targetCommitSha) {
      throw new EngineeringStoreError('Readback de Draft PR no coincide con el efecto', 409, 'REMOTE_READBACK_CONFLICT');
    }
  } else {
    throw new EngineeringStoreError('Efecto remoto no permitido', 409, 'REMOTE_READBACK_INVALID');
  }
  return { remoteProvider, remoteId, remoteUrl, remoteReadbackHash: engineeringHash(readback) };
}

export async function reserveEngineeringEffect(rawInput: unknown) {
  const input = record(rawInput);
  const missionId = text(input.missionId, 200);
  const leaseId = text(input.leaseId, 200);
  const fencingToken = BigInt(String(input.fencingToken));
  const effectInput = validateEffectInput(input);
  const idempotencyKey = text(input.idempotencyKey, 180);
  const requestHash = engineeringHash({ missionId, ...effectInput });
  const db = companyOsV3Prisma();
  return db.$transaction(async (tx) => {
    const prior = await tx.companyOsEngineeringEffect.findUnique({ where: { idempotencyKey } });
    if (prior) {
      if (prior.requestHash !== requestHash) throw new EngineeringStoreError('idempotencyKey reutilizada con otro efecto', 409, 'IDEMPOTENCY_CONFLICT');
      const control = await tx.companyOsEngineeringControl.findUniqueOrThrow({ where: { id: ENGINEERING_CONTROL_ID } });
      const dispatch = prior.status === 'RESERVED' && !control.pauseExecution && !control.emergencyStop;
      return { reused: true, dispatch, effectId: prior.id, status: prior.status, remoteId: prior.remoteId, remoteUrl: prior.remoteUrl };
    }
    const { mission, lease } = await requireLease(tx, { missionId, leaseId, fencingToken });
    if (mission.status !== 'READY_FOR_EFFECT' || mission.autonomyLevel !== 'A2') {
      throw new EngineeringStoreError('Misión no habilitada para A2', 409, 'AUTONOMY_LEVEL_DENIED');
    }
    const leaseVerbs = Array.isArray(lease.allowedVerbs)
      ? lease.allowedVerbs.filter((verb): verb is string => typeof verb === 'string')
      : [];
    if (!leaseVerbs.includes(effectInput.verb)) {
      throw new EngineeringStoreError('Lease de reconciliación no autoriza efectos nuevos', 403, 'EFFECT_VERB_NOT_LEASED');
    }
    if (mission.repository !== effectInput.targetRepository || lease.missionHash !== mission.missionHash) {
      throw new EngineeringStoreError('Efecto no coincide con misión', 409, 'EFFECT_MISSION_MISMATCH');
    }
    const planned = await tx.companyOsEngineeringEffect.create({ data: {
      id: `engineering-effect:${randomUUID()}`, missionId, capabilityLeaseId: leaseId, idempotencyKey,
      requestHash, missionHash: mission.missionHash, ...effectInput, policyHash: mission.policyHash,
      fencingToken, status: 'PLANNED',
    } });
    const effect = await tx.companyOsEngineeringEffect.update({
      where: { id: planned.id }, data: { status: 'RESERVED', reservedAt: new Date() },
    });
    await appendEvent(tx, {
      missionId, eventType: 'ENGINEERING_EFFECT_RESERVED', fromStatus: 'READY_FOR_EFFECT', toStatus: 'READY_FOR_EFFECT',
      payload: { effectId: effect.id, verb: effect.verb, targetHeadBranch: effect.targetHeadBranch, targetCommitSha: effect.targetCommitSha },
      idempotencyKey: `effect-reserved:${idempotencyKey}`, fencingToken,
    });
    return { reused: false, dispatch: true, effectId: effect.id, status: effect.status, remoteId: null, remoteUrl: null };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function markEngineeringEffectDispatching(input: {
  missionId: string; leaseId: string; fencingToken: bigint; effectId: string;
}) {
  const db = companyOsV3Prisma();
  return db.$transaction(async (tx) => {
    await requireLease(tx, input);
    const effect = await tx.companyOsEngineeringEffect.findUniqueOrThrow({ where: { id: input.effectId } });
    if (effect.missionId !== input.missionId || effect.capabilityLeaseId !== input.leaseId || effect.fencingToken !== input.fencingToken) {
      throw new EngineeringStoreError('Effect fencing inválido', 409, 'STALE_FENCING_TOKEN');
    }
    if (effect.status === 'DISPATCHING') return { reused: true, status: effect.status };
    if (effect.status !== 'RESERVED') throw new EngineeringStoreError('Efecto no reservado', 409, 'EFFECT_STATE_CONFLICT');
    await tx.companyOsEngineeringEffect.update({ where: { id: effect.id }, data: { status: 'DISPATCHING', dispatchStartedAt: new Date() } });
    return { reused: false, status: 'DISPATCHING' as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function confirmEngineeringEffect(input: {
  missionId: string; leaseId: string; fencingToken: bigint; effectId: string;
  remoteProvider: string; remoteId: string; remoteUrl: string; remoteReadback: unknown;
}) {
  const db = companyOsV3Prisma();
  return db.$transaction(async (tx) => {
    await requireLease(tx, { ...input, allowExpiredMission: true, allowGoalRevoked: true });
    const effect = await tx.companyOsEngineeringEffect.findUniqueOrThrow({ where: { id: input.effectId } });
    if (effect.missionId !== input.missionId || effect.capabilityLeaseId !== input.leaseId || effect.fencingToken !== input.fencingToken) {
      throw new EngineeringStoreError('Effect fencing inválido', 409, 'STALE_FENCING_TOKEN');
    }
    const { remoteProvider, remoteId, remoteUrl, remoteReadbackHash } = validateEngineeringRemoteReadback(effect, input);
    if (effect.status === 'CONFIRMED') {
      if (effect.remoteProvider !== remoteProvider || effect.remoteId !== remoteId || effect.remoteUrl !== remoteUrl
        || effect.remoteReadbackHash !== remoteReadbackHash) {
        throw new EngineeringStoreError('Readback remoto conflictivo', 409, 'REMOTE_READBACK_CONFLICT');
      }
      return { reused: true, status: effect.status, remoteId: effect.remoteId, remoteUrl: effect.remoteUrl };
    }
    if (!['DISPATCHING', 'UNKNOWN_OUTCOME'].includes(effect.status)) {
      throw new EngineeringStoreError('Efecto no despachado', 409, 'EFFECT_STATE_CONFLICT');
    }
    await tx.companyOsEngineeringEffect.update({ where: { id: effect.id }, data: {
      status: 'CONFIRMED', remoteProvider, remoteId, remoteUrl, remoteReadbackHash,
      confirmedAt: new Date(), reconciledAt: effect.status === 'UNKNOWN_OUTCOME' ? new Date() : null,
    } });
    await appendEvent(tx, {
      missionId: effect.missionId, eventType: 'ENGINEERING_EFFECT_CONFIRMED',
      fromStatus: 'READY_FOR_EFFECT', toStatus: 'READY_FOR_EFFECT',
      payload: { effectId: effect.id, verb: effect.verb, remoteProvider, remoteId, remoteReadbackHash },
      idempotencyKey: `effect-confirmed:${effect.id}`, fencingToken: input.fencingToken,
    });
    return { reused: false, status: 'CONFIRMED' as const, remoteId, remoteUrl };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function markEngineeringEffectUnknown(input: {
  missionId: string; leaseId: string; fencingToken: bigint; effectId: string; errorCode: string;
}) {
  const db = companyOsV3Prisma();
  return db.$transaction(async (tx) => {
    await requireLease(tx, { ...input, allowExpiredMission: true, allowGoalRevoked: true });
    const effect = await tx.companyOsEngineeringEffect.findUniqueOrThrow({ where: { id: input.effectId } });
    if (effect.missionId !== input.missionId || effect.fencingToken !== input.fencingToken || effect.status !== 'DISPATCHING') {
      throw new EngineeringStoreError('Efecto no admite UNKNOWN_OUTCOME', 409, 'EFFECT_STATE_CONFLICT');
    }
    await tx.companyOsEngineeringEffect.update({ where: { id: effect.id }, data: {
      status: 'UNKNOWN_OUTCOME', lastErrorCode: text(input.errorCode, 80),
    } });
    await tx.companyOsEngineeringCapabilityLease.update({
      where: { id: input.leaseId }, data: { status: 'RELEASED', revokedAt: new Date() },
    });
    return { status: 'UNKNOWN_OUTCOME' as const, retryDispatch: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function completeEngineeringMission(input: {
  missionId: string; leaseId: string; fencingToken: bigint; evidence: unknown;
}) {
  const db = companyOsV3Prisma();
  return db.$transaction(async (tx) => {
    const { mission, lease } = await requireLease(tx, input);
    const effects = await tx.companyOsEngineeringEffect.findMany({ where: { missionId: mission.id } });
    if (effects.some((effect) => !['CONFIRMED', 'FAILED'].includes(effect.status))) {
      throw new EngineeringStoreError('La misión tiene efectos sin confirmar', 409, 'UNCONFIRMED_EFFECTS_BLOCK_COMPLETION');
    }
    const confirmedPush = effects.some((effect) => effect.verb === 'PUSH_BRANCH' && effect.status === 'CONFIRMED');
    const confirmedDraft = effects.some((effect) => effect.verb === 'CREATE_DRAFT_PR' && effect.status === 'CONFIRMED');
    if (mission.autonomyLevel === 'A2' && (!confirmedPush || !confirmedDraft)) {
      throw new EngineeringStoreError('A2 requiere branch y Draft PR confirmados', 409, 'DRAFT_PR_READBACK_REQUIRED');
    }
    const fromStatus = mission.status as EngineeringMissionState;
    if (!['READY_FOR_EFFECT', 'READY_FOR_HUMAN'].includes(fromStatus)) {
      throw new EngineeringStoreError('Misión no lista para completar', 409, 'MISSION_STATE_CONFLICT');
    }
    const verificationEvent = await tx.companyOsEngineeringEvent.findFirst({
      where: {
        missionId: mission.id,
        eventType: { in: ['ENGINEERING_READY_FOR_EFFECT', 'ENGINEERING_READY_FOR_HUMAN'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    assertDesiredStateReadback(mission.desiredState, verificationEvent?.payload);
    await setMissionStatus(tx, {
      missionId: mission.id, fromStatus, toStatus: 'COMPLETED', eventType: 'ENGINEERING_MISSION_COMPLETED',
      payload: { evidenceHash: engineeringHash(input.evidence), confirmedEffects: effects.filter((effect) => effect.status === 'CONFIRMED').length },
      idempotencyKey: `mission-completed:${lease.id}`, fencingToken: lease.fencingToken, completedAt: new Date(),
    });
    await tx.companyOsEngineeringCapabilityLease.update({ where: { id: lease.id }, data: { status: 'RELEASED', revokedAt: new Date() } });
    return {
      status: 'COMPLETED' as const,
      missionId: mission.id,
      confirmedEffects: effects.filter((effect) => effect.status === 'CONFIRMED').length,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function failEngineeringMission(input: {
  missionId: string; leaseId: string; fencingToken: bigint; errorCode: string; retryable: boolean;
}) {
  const db = companyOsV3Prisma();
  return db.$transaction(async (tx) => {
    const { mission, lease } = await requireLease(tx, { ...input, allowExpiredMission: true, allowGoalRevoked: true });
    if (mission.status === 'READY_FOR_EFFECT') {
      await tx.companyOsEngineeringEffect.updateMany({
        where: { missionId: mission.id, status: 'DISPATCHING' },
        data: { status: 'UNKNOWN_OUTCOME', lastErrorCode: text(input.errorCode, 80) },
      });
      await tx.companyOsEngineeringEffect.updateMany({
        where: { missionId: mission.id, status: { in: ['PLANNED', 'RESERVED'] } },
        data: { status: 'FAILED', lastErrorCode: text(input.errorCode, 80) },
      });
      const unknownEffects = await tx.companyOsEngineeringEffect.count({
        where: { missionId: mission.id, status: 'UNKNOWN_OUTCOME' },
      });
      if (unknownEffects > 0) {
        await tx.companyOsEngineeringCapabilityLease.update({ where: { id: lease.id }, data: {
          status: 'EXPIRED', revokedAt: new Date(),
        } });
        return {
          status: 'READY_FOR_EFFECT' as const,
          retryable: true,
          nextAttemptAt: null,
          reconciliationRequired: true,
        };
      }
    }
    const result = await transitionEngineeringFailure(tx, {
      mission,
      errorCode: text(input.errorCode, 80),
      requestedRetry: input.retryable,
      idempotencyKey: `mission-failed:${lease.id}`,
      fencingToken: lease.fencingToken,
    });
    await tx.companyOsEngineeringCapabilityLease.update({ where: { id: lease.id }, data: {
      status: result.retryable ? 'EXPIRED' : 'REVOKED', revokedAt: new Date(),
    } });
    return { status: result.status, retryable: result.retryable, nextAttemptAt: result.nextAttemptAt?.toISOString() ?? null };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function getEngineeringControlCenter() {
  const db = companyOsV3Prisma();
  const [control, missions, effects, leases, events] = await Promise.all([
    db.companyOsEngineeringControl.findUniqueOrThrow({ where: { id: ENGINEERING_CONTROL_ID } }),
    db.companyOsEngineeringMission.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }),
    db.companyOsEngineeringEffect.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }),
    db.companyOsEngineeringCapabilityLease.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
    db.companyOsEngineeringEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    control,
    missions: missions.map((mission) => ({ ...mission, budgetUsd: decimalNumber(mission.budgetUsd), spentUsd: decimalNumber(mission.spentUsd), fencingCounter: mission.fencingCounter.toString() })),
    effects: effects.map((effect) => ({ ...effect, fencingToken: effect.fencingToken.toString() })),
    leases: leases.map((lease) => ({ ...lease, budgetUsd: decimalNumber(lease.budgetUsd), fencingToken: lease.fencingToken.toString() })),
    events: events.map((event) => ({ ...event, fencingToken: event.fencingToken?.toString() ?? null })),
  };
}

export async function applyEngineeringControl(input: {
  action: 'PAUSE_INTAKE' | 'RESUME_INTAKE' | 'PAUSE_EXECUTION' | 'RESUME_EXECUTION' | 'EMERGENCY_STOP' | 'CLEAR_EMERGENCY'
    | 'QUARANTINE_REPOSITORY' | 'UNQUARANTINE_REPOSITORY' | 'DISABLE_ACTOR' | 'ENABLE_ACTOR';
  target?: string;
  idempotencyKey: string;
  actorRef: string;
}) {
  const key = text(input.idempotencyKey, 160);
  const target = input.target?.trim() || null;
  const requestHash = engineeringHash({ action: input.action, target });
  const db = companyOsV3Prisma();
  return db.$transaction(async (tx) => {
    const auditKey = `audit:engineering-control:${key}`;
    const prior = await tx.companyOsAuditEvent.findUnique({ where: { idempotencyKey: auditKey } });
    if (prior) {
      const metadata = prior.metadata && typeof prior.metadata === 'object' && !Array.isArray(prior.metadata)
        ? prior.metadata as Record<string, unknown> : {};
      if (metadata.requestHash !== requestHash) throw new EngineeringStoreError('idempotencyKey reutilizada', 409, 'IDEMPOTENCY_CONFLICT');
      return { reused: true, action: input.action, target };
    }
    const control = await tx.companyOsEngineeringControl.findUniqueOrThrow({ where: { id: ENGINEERING_CONTROL_ID } });
    const data: Prisma.CompanyOsEngineeringControlUpdateInput = { updatedBy: input.actorRef };
    if (input.action === 'PAUSE_INTAKE') data.pauseIntake = true;
    if (input.action === 'RESUME_INTAKE') data.pauseIntake = false;
    if (input.action === 'PAUSE_EXECUTION') data.pauseExecution = true;
    if (input.action === 'RESUME_EXECUTION') {
      if (control.emergencyStop) throw new EngineeringStoreError('Primero debe limpiarse emergency stop', 409, 'GLOBAL_EMERGENCY_STOP');
      data.pauseExecution = false;
    }
    if (input.action === 'EMERGENCY_STOP') Object.assign(data, { emergencyStop: true, pauseExecution: true, pauseIntake: true });
    if (input.action === 'CLEAR_EMERGENCY') data.emergencyStop = false;
    const updateList = (current: string[], add: boolean, value: string) => add
      ? [...new Set([...current, value])]
      : current.filter((item) => item !== value);
    if (['QUARANTINE_REPOSITORY', 'UNQUARANTINE_REPOSITORY'].includes(input.action)) {
      if (target !== ALLOWED_REPOSITORY) throw new EngineeringStoreError('Repositorio inválido', 400, 'TARGET_NOT_ALLOWLISTED');
      data.quarantinedRepositories = updateList(control.quarantinedRepositories, input.action === 'QUARANTINE_REPOSITORY', target);
    }
    if (['DISABLE_ACTOR', 'ENABLE_ACTOR'].includes(input.action)) {
      const actor = text(target, 160);
      data.disabledActors = updateList(control.disabledActors, input.action === 'DISABLE_ACTOR', actor);
    }
    await tx.companyOsEngineeringControl.update({ where: { id: ENGINEERING_CONTROL_ID }, data });
    if (input.action === 'EMERGENCY_STOP' || input.action === 'PAUSE_EXECUTION') {
      const activeLeases = await tx.companyOsEngineeringCapabilityLease.findMany({
        where: { status: 'ACTIVE' }, select: { id: true, missionId: true, fencingToken: true },
      });
      for (const activeLease of activeLeases) {
        const mission = await tx.companyOsEngineeringMission.findUnique({ where: { id: activeLease.missionId } });
        if (!mission) continue;
        const status = mission.status as EngineeringMissionState;
        await tx.companyOsEngineeringEffect.updateMany({
          where: { capabilityLeaseId: activeLease.id, status: 'DISPATCHING' },
          data: { status: 'UNKNOWN_OUTCOME', lastErrorCode: 'LEASE_REVOKED_DURING_EFFECT' },
        });
        if (input.action === 'EMERGENCY_STOP') {
          await appendEvent(tx, {
            missionId: mission.id,
            eventType: 'EMERGENCY_STOP_VERIFIED',
            fromStatus: status,
            toStatus: status,
            payload: { controlId: ENGINEERING_CONTROL_ID, action: input.action },
            idempotencyKey: `emergency-stop:${key}:${mission.id}`,
            fencingToken: activeLease.fencingToken,
          });
        }
        if (ACTIVE_MISSION_STATES.includes(status as typeof ACTIVE_MISSION_STATES[number])) {
          await transitionEngineeringFailure(tx, {
            mission,
            errorCode: input.action === 'EMERGENCY_STOP' ? 'EMERGENCY_STOP_RECOVERY' : 'EXECUTION_PAUSED_RECOVERY',
            requestedRetry: true,
            eventType: input.action === 'EMERGENCY_STOP' ? 'EMERGENCY_STOP_RECOVERY' : 'EXECUTION_PAUSED_RECOVERY',
            payload: { controlId: ENGINEERING_CONTROL_ID, action: input.action, leaseId: activeLease.id },
            idempotencyKey: `control-recovery:${key}:${activeLease.id}`,
            fencingToken: activeLease.fencingToken,
          });
        }
      }
      await tx.companyOsEngineeringCapabilityLease.updateMany({
        where: { status: 'ACTIVE' }, data: { status: 'REVOKED', revokedAt: new Date() },
      });
    }
    await tx.companyOsAuditEvent.create({ data: {
      requestId: 'engineering-control', action: input.action, actorRef: input.actorRef,
      metadata: jsonValue({ requestHash, target, autonomousProductionEffects: 0 }), idempotencyKey: auditKey,
    } });
    return { reused: false, action: input.action, target };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
