import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { companyReadPrisma } from './read-prisma';

export const MISSION_STATUSES = [
  'PLANNED',
  'APPROVED',
  'REJECTED',
  'RUNNING',
  'BLOCKED',
  'REVIEW',
  'DONE',
] as const;

export const HUMAN_MISSION_ACTIONS = [
  'APPROVE',
  'REJECT',
  'EDIT',
  'POSTPONE',
  'MARK_INCORRECT',
] as const;

export type MissionStatus = (typeof MISSION_STATUSES)[number];
export type HumanMissionAction = (typeof HUMAN_MISSION_ACTIONS)[number];
export type JsonObject = Record<string, Prisma.JsonValue>;

export type MissionDecisionInput = {
  missionId: string;
  action: HumanMissionAction;
  expectedHead: number;
  idempotencyKey: string;
  reason?: string | null;
  deferUntil?: string | null;
  revisionPayload?: JsonObject | null;
  incorrectData?: JsonObject | null;
};

export type HumanMissionIdentity = {
  authMode: 'admin-session';
  actorRef: string;
};

export type MissionEventRecord = {
  id: string;
  missionId: string;
  sequence: number;
  action: string;
  fromStatus: string;
  toStatus: string;
  actorRef: string;
  authMode: string;
  reason: string | null;
  deferUntil: Date | null;
  revisionPayload: Prisma.JsonValue | null;
  incorrectData: Prisma.JsonValue | null;
  expectedHead: number;
  idempotencyKey: string;
  requestHash: string;
  previousHash: string | null;
  eventHash: string;
  createdAt: Date;
};

export class MissionDecisionError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 422 | 500,
    readonly code: string,
  ) {
    super(message);
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new MissionDecisionError('JSON contiene un número inválido', 400, 'INVALID_JSON');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
  }
  throw new MissionDecisionError('JSON contiene un tipo no permitido', 400, 'INVALID_JSON');
}

function sha256(value: unknown) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function isMissionStatus(value: string): value is MissionStatus {
  return (MISSION_STATUSES as readonly string[]).includes(value);
}

function requireJsonObject(value: unknown, field: string): JsonObject {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new MissionDecisionError(`${field} debe ser un objeto JSON`, 400, 'INVALID_PAYLOAD');
  }
  const serialized = canonicalJson(value);
  if (serialized.length > 16_384) {
    throw new MissionDecisionError(`${field} supera 16 KB`, 400, 'PAYLOAD_TOO_LARGE');
  }
  return value as JsonObject;
}

function requireRevisionPayload(value: unknown): JsonObject {
  const payload = requireJsonObject(value, 'revisionPayload');
  const allowed = new Set(['mission', 'why', 'expectedOutput']);
  const keys = Object.keys(payload);
  if (keys.length === 0 || keys.some((key) => !allowed.has(key))) {
    throw new MissionDecisionError(
      'revisionPayload sólo admite mission, why y expectedOutput',
      400,
      'INVALID_REVISION_PAYLOAD',
    );
  }
  for (const key of keys) {
    const fieldValue = payload[key];
    if (typeof fieldValue !== 'string' || !fieldValue.trim() || fieldValue.trim().length > 1200) {
      throw new MissionDecisionError(
        `revisionPayload.${key} debe ser texto entre 1 y 1200 caracteres`,
        400,
        'INVALID_REVISION_PAYLOAD',
      );
    }
    payload[key] = fieldValue.trim();
  }
  return payload;
}

export function normalizeMissionDecision(input: MissionDecisionInput, now = new Date()) {
  const missionId = String(input.missionId ?? '').trim();
  const action = String(input.action ?? '').trim().toUpperCase() as HumanMissionAction;
  const idempotencyKey = String(input.idempotencyKey ?? '').trim();
  const reason = input.reason == null ? null : String(input.reason).trim();

  if (!missionId || missionId.length > 128) {
    throw new MissionDecisionError('missionId inválido', 400, 'INVALID_MISSION_ID');
  }
  if (!(HUMAN_MISSION_ACTIONS as readonly string[]).includes(action)) {
    throw new MissionDecisionError('Acción humana no permitida en V2', 422, 'ACTION_NOT_ALLOWED');
  }
  if (!Number.isInteger(input.expectedHead) || input.expectedHead < 0) {
    throw new MissionDecisionError('expectedHead debe ser un entero no negativo', 400, 'INVALID_EXPECTED_HEAD');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(idempotencyKey)) {
    throw new MissionDecisionError('idempotencyKey inválida', 400, 'INVALID_IDEMPOTENCY_KEY');
  }
  if (reason && reason.length > 1000) {
    throw new MissionDecisionError('reason supera 1000 caracteres', 400, 'REASON_TOO_LONG');
  }

  let deferUntil: Date | null = null;
  let revisionPayload: JsonObject | null = null;
  let incorrectData: JsonObject | null = null;

  if (action === 'REJECT' && !reason) {
    throw new MissionDecisionError('Rechazar requiere un motivo', 400, 'REASON_REQUIRED');
  }
  if (action === 'EDIT') {
    revisionPayload = requireRevisionPayload(input.revisionPayload);
  } else if (input.revisionPayload != null) {
    throw new MissionDecisionError('revisionPayload sólo se admite al editar', 400, 'UNEXPECTED_PAYLOAD');
  }
  if (action === 'POSTPONE') {
    deferUntil = new Date(String(input.deferUntil ?? ''));
    if (Number.isNaN(deferUntil.getTime()) || deferUntil.getTime() <= now.getTime()) {
      throw new MissionDecisionError('Posponer requiere deferUntil futuro', 400, 'INVALID_DEFER_UNTIL');
    }
  } else if (input.deferUntil != null) {
    throw new MissionDecisionError('deferUntil sólo se admite al posponer', 400, 'UNEXPECTED_DEFER_UNTIL');
  }
  if (action === 'MARK_INCORRECT') {
    if (!reason) throw new MissionDecisionError('Marcar información incorrecta requiere un motivo', 400, 'REASON_REQUIRED');
    incorrectData = requireJsonObject(input.incorrectData, 'incorrectData');
  } else if (input.incorrectData != null) {
    throw new MissionDecisionError('incorrectData sólo se admite al marcar información incorrecta', 400, 'UNEXPECTED_PAYLOAD');
  }

  return {
    missionId,
    action,
    expectedHead: input.expectedHead,
    idempotencyKey,
    reason,
    deferUntil,
    revisionPayload,
    incorrectData,
  };
}

export function missionTransition(fromStatus: MissionStatus, action: HumanMissionAction): MissionStatus {
  const allowed: Record<HumanMissionAction, Partial<Record<MissionStatus, MissionStatus>>> = {
    APPROVE: { PLANNED: 'APPROVED', REVIEW: 'APPROVED' },
    REJECT: { PLANNED: 'REJECTED', APPROVED: 'REJECTED', BLOCKED: 'REJECTED', REVIEW: 'REJECTED' },
    EDIT: { PLANNED: 'REVIEW', APPROVED: 'REVIEW', BLOCKED: 'REVIEW', REVIEW: 'REVIEW' },
    POSTPONE: { PLANNED: 'PLANNED', APPROVED: 'PLANNED', BLOCKED: 'PLANNED', REVIEW: 'PLANNED' },
    MARK_INCORRECT: { PLANNED: 'BLOCKED', APPROVED: 'BLOCKED', REVIEW: 'BLOCKED' },
  };
  const toStatus = allowed[action][fromStatus];
  if (!toStatus) {
    throw new MissionDecisionError(
      `Transición ${fromStatus} mediante ${action} no permitida`,
      422,
      'TRANSITION_NOT_ALLOWED',
    );
  }
  return toStatus;
}

function requestHash(input: ReturnType<typeof normalizeMissionDecision>, identity: HumanMissionIdentity) {
  return sha256({
    missionId: input.missionId,
    action: input.action,
    expectedHead: input.expectedHead,
    idempotencyKey: input.idempotencyKey,
    actorRef: identity.actorRef,
    authMode: identity.authMode,
    reason: input.reason,
    deferUntil: input.deferUntil?.toISOString() ?? null,
    revisionPayload: input.revisionPayload,
    incorrectData: input.incorrectData,
  });
}

export function computeMissionEventHash(event: Omit<MissionEventRecord, 'id' | 'eventHash'>) {
  return sha256({
    missionId: event.missionId,
    sequence: event.sequence,
    action: event.action,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    actorRef: event.actorRef,
    authMode: event.authMode,
    reason: event.reason,
    deferUntil: event.deferUntil?.toISOString() ?? null,
    revisionPayload: event.revisionPayload,
    incorrectData: event.incorrectData,
    expectedHead: event.expectedHead,
    idempotencyKey: event.idempotencyKey,
    requestHash: event.requestHash,
    previousHash: event.previousHash,
    createdAt: event.createdAt.toISOString(),
  });
}

export function verifyMissionEventChain(events: MissionEventRecord[]) {
  let previousHash: string | null = null;
  for (const [index, event] of events.entries()) {
    if (event.sequence !== index + 1 || event.expectedHead !== index || event.previousHash !== previousHash) return false;
    const hashable: Omit<MissionEventRecord, 'id' | 'eventHash'> = {
      missionId: event.missionId,
      sequence: event.sequence,
      action: event.action,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      actorRef: event.actorRef,
      authMode: event.authMode,
      reason: event.reason,
      deferUntil: event.deferUntil,
      revisionPayload: event.revisionPayload,
      incorrectData: event.incorrectData,
      expectedHead: event.expectedHead,
      idempotencyKey: event.idempotencyKey,
      requestHash: event.requestHash,
      previousHash: event.previousHash,
      createdAt: event.createdAt,
    };
    if (computeMissionEventHash(hashable) !== event.eventHash) return false;
    previousHash = event.eventHash;
  }
  return true;
}

function eventView(event: MissionEventRecord) {
  return {
    ...event,
    deferUntil: event.deferUntil?.toISOString() ?? null,
    createdAt: event.createdAt.toISOString(),
  };
}

export function effectiveMissionRevision(events: MissionEventRecord[]) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].revisionPayload != null) return events[index].revisionPayload;
  }
  return null;
}

function projectedMission<T extends { status: string; events: MissionEventRecord[] }>(mission: T) {
  if (!isMissionStatus(mission.status)) {
    throw new MissionDecisionError('Estado base de misión inválido', 500, 'AUDIT_INTEGRITY_ERROR');
  }
  if (!verifyMissionEventChain(mission.events)) {
    throw new MissionDecisionError('Cadena de auditoría inválida', 500, 'AUDIT_INTEGRITY_ERROR');
  }
  const latest = mission.events.at(-1) ?? null;
  const status = latest?.toStatus ?? mission.status;
  if (!isMissionStatus(status)) {
    throw new MissionDecisionError('Estado proyectado inválido', 500, 'AUDIT_INTEGRITY_ERROR');
  }
  const { events, ...base } = mission;
  return {
    ...base,
    originalStatus: mission.status as MissionStatus,
    status,
    head: { sequence: latest?.sequence ?? 0, eventHash: latest?.eventHash ?? null },
    eventCount: events.length,
    effectiveRevision: effectiveMissionRevision(events),
    latestEvent: latest ? eventView(latest) : null,
    events: events.map(eventView),
    chainValid: true,
  };
}

export async function listProjectedMissions(runId: string) {
  const cleanRunId = runId.trim();
  if (!cleanRunId || cleanRunId.length > 128) {
    throw new MissionDecisionError('runId inválido', 400, 'INVALID_RUN_ID');
  }
  const run = await companyReadPrisma().companyAgentRun.findUnique({
    where: { id: cleanRunId },
    select: {
      id: true,
      businessDate: true,
      snapshotId: true,
      createdAt: true,
      missions: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          runId: true,
          agent: true,
          mission: true,
          why: true,
          expectedOutput: true,
          status: true,
          createdAt: true,
          events: { orderBy: { sequence: 'asc' } },
        },
      },
    },
  });
  if (!run) throw new MissionDecisionError('Ciclo no encontrado', 404, 'RUN_NOT_FOUND');
  return {
    runId: run.id,
    businessDate: run.businessDate,
    snapshotId: run.snapshotId,
    createdAt: run.createdAt.toISOString(),
    missions: run.missions.map(projectedMission),
  };
}

export async function recordHumanMissionDecision(
  rawInput: MissionDecisionInput,
  identity: HumanMissionIdentity,
) {
  const normalized = normalizeMissionDecision(rawInput);
  const inputRequestHash = requestHash(normalized, identity);

  return companyReadPrisma().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`company-os-mission:${normalized.missionId}`}, 0))`;

    const mission = await tx.companyAgentMission.findUnique({
      where: { id: normalized.missionId },
      select: { id: true, runId: true, agent: true, mission: true, why: true, expectedOutput: true, status: true, createdAt: true },
    });
    if (!mission) throw new MissionDecisionError('Misión no encontrada', 404, 'MISSION_NOT_FOUND');

    const existing = await tx.companyAgentMissionEvent.findUnique({
      where: {
        missionId_idempotencyKey: {
          missionId: normalized.missionId,
          idempotencyKey: normalized.idempotencyKey,
        },
      },
    });
    if (existing) {
      if (existing.requestHash !== inputRequestHash) {
      throw new MissionDecisionError('idempotencyKey reutilizada con otro contenido', 409, 'IDEMPOTENCY_CONFLICT');
      }
      const events = await tx.companyAgentMissionEvent.findMany({
        where: { missionId: normalized.missionId },
        orderBy: { sequence: 'asc' },
      });
      return { mission: projectedMission({ ...mission, events }), event: eventView(existing), reused: true };
    }

    const events = await tx.companyAgentMissionEvent.findMany({
      where: { missionId: normalized.missionId },
      orderBy: { sequence: 'asc' },
    });
    if (!verifyMissionEventChain(events)) {
      throw new MissionDecisionError('Cadena de auditoría inválida', 500, 'AUDIT_INTEGRITY_ERROR');
    }
    const latest = events.at(-1) ?? null;
    const actualHead = latest?.sequence ?? 0;
    if (actualHead !== normalized.expectedHead) {
      throw new MissionDecisionError(
        `Conflicto de versión: expectedHead=${normalized.expectedHead}, actualHead=${actualHead}`,
        409,
        'HEAD_CONFLICT',
      );
    }
    const fromStatus = latest?.toStatus ?? mission.status;
    if (!isMissionStatus(fromStatus)) {
      throw new MissionDecisionError('Estado proyectado inválido', 500, 'AUDIT_INTEGRITY_ERROR');
    }
    const toStatus = missionTransition(fromStatus, normalized.action);
    const createdAt = new Date();
    if (normalized.deferUntil && normalized.deferUntil.getTime() <= createdAt.getTime()) {
      throw new MissionDecisionError('deferUntil dejó de ser futuro', 409, 'DEFER_UNTIL_ELAPSED');
    }
    const sequence = actualHead + 1;
    const hashable = {
      missionId: normalized.missionId,
      sequence,
      action: normalized.action,
      fromStatus,
      toStatus,
      actorRef: identity.actorRef,
      authMode: identity.authMode,
      reason: normalized.reason,
      deferUntil: normalized.deferUntil,
      revisionPayload: normalized.revisionPayload,
      incorrectData: normalized.incorrectData,
      expectedHead: normalized.expectedHead,
      idempotencyKey: normalized.idempotencyKey,
      requestHash: inputRequestHash,
      previousHash: latest?.eventHash ?? null,
      createdAt,
    };
    const eventHash = computeMissionEventHash(hashable);
    const created = await tx.companyAgentMissionEvent.create({
      data: {
        ...hashable,
        revisionPayload: normalized.revisionPayload ?? Prisma.DbNull,
        incorrectData: normalized.incorrectData ?? Prisma.DbNull,
        eventHash,
      },
    });

    const readback = await tx.companyAgentMissionEvent.findMany({
      where: { missionId: normalized.missionId },
      orderBy: { sequence: 'asc' },
    });
    if (readback.length !== sequence || !verifyMissionEventChain(readback) || readback.at(-1)?.eventHash !== eventHash) {
      throw new MissionDecisionError('Readback de auditoría incompleto', 500, 'AUDIT_READBACK_FAILED');
    }
    return { mission: projectedMission({ ...mission, events: readback }), event: eventView(created), reused: false };
  }, { maxWait: 15_000, timeout: 15_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
