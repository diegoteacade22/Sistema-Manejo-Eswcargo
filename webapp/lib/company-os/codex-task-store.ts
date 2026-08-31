import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { sanitizeCompanyText } from './objective';
import { companyReadPrisma } from './read-prisma';
import { companyOsV3Prisma } from './v3-prisma';

const HUMAN_STATUSES = new Set(['UNREVIEWED', 'PENDING', 'IN_PROGRESS', 'NEEDS_DIEGO', 'BLOCKED', 'READY_REVIEW', 'DONE', 'MONITORING', 'DISCARDED']);
const SOURCE_STATUSES = new Set(['ACTIVE', 'IDLE', 'NOT_LOADED', 'ARCHIVED', 'UNKNOWN']);
const CATEGORIES = new Set(['GENERAL', 'SYSTEMS', 'OPERATIONS', 'COMMERCIAL', 'FINANCE', 'CUSTOMERS', 'PERSONAL', 'MONITOR']);
const AUTONOMY_LEVELS = new Set(['A0', 'A1', 'A2', 'HUMAN']);
const MANAGED_TARGET_STATUSES = new Set(['PENDING', 'NEEDS_DIEGO', 'BLOCKED', 'READY_REVIEW', 'MONITORING']);
const REOPEN_TARGET_STATUSES = new Set(['PENDING', 'NEEDS_DIEGO']);
const MANAGEMENT_ACTIONS = new Set(['MOVE', 'MOVE_PROJECT', 'ARCHIVE', 'CLOSE', 'REOPEN']);
const CODEX_AUTO_RESUME_ACTOR = 'codex-intake-ai-v1';
const CODEX_AUTO_RESUME_STALE_MS = 2 * 60 * 60_000;
const CODEX_AUTO_RESUME_MAX_FAILURES = 3;
const UNASSIGNED_PROJECT = 'SIN PROYECTO ASIGNADO';

export class CodexTaskStoreError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'CodexTaskStoreError';
  }
}

function record(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CodexTaskStoreError('Snapshot Codex inválido');
  return value as Record<string, unknown>;
}

function safeText(value: unknown, max: number, fallback?: string) {
  const source = typeof value === 'string'
    ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    : '';
  const safe = sanitizeCompanyText(source, max).safeText.trim();
  if (safe) return safe;
  if (fallback) return fallback;
  throw new CodexTaskStoreError('Texto Codex obligatorio ausente');
}

function safeThreadId(value: unknown) {
  const threadId = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(threadId)) throw new CodexTaskStoreError('threadId Codex inválido');
  return threadId;
}

function safeIdempotencyKey(value: unknown) {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9:_-]{16,160}$/.test(key)) throw new CodexTaskStoreError('Clave idempotente inválida');
  return key;
}

function safeFingerprint(value: unknown) {
  const valueString = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[0-9a-f]{64}$/.test(valueString)) throw new CodexTaskStoreError('La versión de la tarea es inválida');
  return valueString;
}

function canonicalProjectName(value: unknown, allowUnassigned = false) {
  const name = safeText(value, 160);
  if (allowUnassigned && name === UNASSIGNED_PROJECT) return name;
  if (name !== name.toLocaleUpperCase('es-US') || /[-–—]/.test(name)) {
    throw new CodexTaskStoreError('Nombre de proyecto Codex no canónico');
  }
  return name;
}

function isCanonicalProjectName(value: string) {
  return value === UNASSIGNED_PROJECT
    || (value === value.toLocaleUpperCase('es-US') && !/[-–—]/.test(value));
}

function normalizeSourceProjectName(value: unknown) {
  const name = safeText(value, 160, UNASSIGNED_PROJECT);
  return isCanonicalProjectName(name) ? name : UNASSIGNED_PROJECT;
}

function nativeProjectCatalog(value: unknown) {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw new CodexTaskStoreError('Catálogo nativo Codex inválido');
  }
  return [...new Set(value.map((name) => canonicalProjectName(name)))]
    .filter((name) => name !== UNASSIGNED_PROJECT)
    .sort();
}

function projectCatalogHash(projectNames: string[]) {
  return createHash('sha256').update(JSON.stringify(projectNames)).digest('hex');
}

function catalogHashFromSync(scanId: string) {
  return scanId.match(/:catalog:([0-9a-f]{64})$/)?.[1] ?? null;
}

function safeDispatchToken(value: unknown) {
  const token = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9_-]{24,128}$/.test(token)) throw new CodexTaskStoreError('Token de despacho inválido');
  return token;
}

function dispatchBinding(sourceHost: string, instanceId: string, claimToken: string) {
  return createHash('sha256').update(`${sourceHost}\n${instanceId}\n${claimToken}`).digest('hex');
}

function claimBaselineToken(lastCompletedAt: Date | null) {
  return lastCompletedAt ? `ms-${lastCompletedAt.getTime().toString(36)}` : 'none';
}

function claimBaselineFromKey(idempotencyKey: string, claimKeyPrefix: string) {
  if (!idempotencyKey.startsWith(claimKeyPrefix)) return { valid: false, value: null as Date | null };
  const token = idempotencyKey.slice(claimKeyPrefix.length).split(':', 1)[0];
  if (token === 'none') return { valid: true, value: null as Date | null };
  if (!/^ms-[0-9a-z]{1,16}$/.test(token)) return { valid: false, value: null as Date | null };
  const milliseconds = Number.parseInt(token.slice(3), 36);
  const value = new Date(milliseconds);
  return Number.isFinite(milliseconds) && !Number.isNaN(value.getTime())
    ? { valid: true, value }
    : { valid: false, value: null as Date | null };
}

function enumValue(value: unknown, allowed: Set<string>, fallback: string) {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return allowed.has(normalized) ? normalized : fallback;
}

function isoDate(value: unknown, fallback?: Date) {
  const parsed = typeof value === 'string' ? new Date(value) : fallback;
  if (!parsed || Number.isNaN(parsed.getTime())) throw new CodexTaskStoreError('Fecha Codex inválida');
  return parsed;
}

function nullableDate(value: unknown) {
  if (value == null || value === '') return null;
  return isoDate(value);
}

function fingerprint(input: Record<string, unknown>) {
  const supplied = typeof input.fingerprint === 'string' ? input.fingerprint.trim().toLowerCase() : '';
  if (/^[0-9a-f]{64}$/.test(supplied)) return supplied;
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function taskInput(raw: unknown, sourceHost: string, observedAt: Date, nativeProjectNames: Set<string> | null) {
  const input = record(raw);
  const threadId = safeThreadId(input.threadId);
  const humanStatus = enumValue(input.humanStatus, HUMAN_STATUSES, 'UNREVIEWED');
  const sourceStatus = enumValue(input.sourceStatus, SOURCE_STATUSES, 'UNKNOWN');
  const category = enumValue(input.category, CATEGORIES, 'GENERAL');
  const autonomyLevel = enumValue(input.autonomyLevel, AUTONOMY_LEVELS, 'A0');
  const priority = Math.min(5, Math.max(1, Math.trunc(Number(input.priority) || 3)));
  const archived = input.archived === true;
  const sourceProjectName = normalizeSourceProjectName(input.projectName);
  return {
    id: `codex-task:${threadId}`,
    threadId,
    sourceHost,
    title: safeText(input.title, 240, 'Tarea Codex sin título'),
    projectName: sourceProjectName === UNASSIGNED_PROJECT || !nativeProjectNames || nativeProjectNames.has(sourceProjectName)
      ? sourceProjectName
      : UNASSIGNED_PROJECT,
    category,
    humanStatus,
    sourceStatus,
    priority,
    nextAction: safeText(input.nextAction, 500, humanStatus === 'DONE' ? 'Revisar el resultado si hace falta.' : 'Retomar y definir el próximo resultado verificable.'),
    attentionReason: input.attentionReason == null ? null : safeText(input.attentionReason, 500),
    autonomyLevel,
    codexUrl: `codex://threads/${threadId}`,
    fingerprint: fingerprint(input),
    sourceUpdatedAt: isoDate(input.sourceUpdatedAt, observedAt),
    lastStartedAt: nullableDate(input.lastStartedAt),
    lastCompletedAt: nullableDate(input.lastCompletedAt),
    lastObservedAt: observedAt,
    archived,
  };
}

export async function ingestCodexTaskChunk(raw: unknown, actorRef: string) {
  const input = record(raw);
  const sourceHost = safeText(input.sourceHost, 120);
  const scanId = safeText(input.scanId, 160);
  const tasks = Array.isArray(input.tasks) ? input.tasks : [];
  if (tasks.length > 100 || (!tasks.length && !(input.finalChunk === true && Number(input.observedCount) === 0))) {
    throw new CodexTaskStoreError('Cada lote debe contener hasta 100 tareas; sólo el escaneo final vacío puede no incluir tareas');
  }
  const observedAt = isoDate(input.observedAt, new Date());
  const catalog = nativeProjectCatalog(input.nativeProjectNames);
  const catalogHash = catalog ? projectCatalogHash(catalog) : null;
  const nativeProjectNames = catalog ? new Set(catalog) : null;
  const normalized = tasks.map((task) => taskInput(task, sourceHost, observedAt, nativeProjectNames));
  const db = companyOsV3Prisma();
  let changedCount = 0;

  await db.$transaction(async (tx) => {
    for (const task of normalized) {
      const previous = await tx.companyOsCodexTask.findUnique({
        where: { threadId: task.threadId },
        select: { fingerprint: true, humanStatus: true, lastCompletedAt: true },
      });
      if (!previous || previous.fingerprint !== task.fingerprint) changedCount += 1;
      const persistedTask = previous?.humanStatus === 'DONE' && previous.fingerprint === task.fingerprint
        ? { ...task, humanStatus: 'DONE', nextAction: 'Realizada y validada por Diego.', attentionReason: null, lastCompletedAt: previous.lastCompletedAt }
        : task;
      await tx.companyOsCodexTask.upsert({
        where: { threadId: task.threadId },
        update: persistedTask,
        create: persistedTask,
      });
      if (!previous || previous.fingerprint !== task.fingerprint) {
        await tx.companyOsCodexTaskObservation.createMany({
          data: [{
            id: `codex-observation:${randomUUID()}`,
            taskId: task.id,
            fingerprint: task.fingerprint,
            humanStatus: task.humanStatus,
            sourceStatus: task.sourceStatus,
            actorRef,
            observedAt,
          }],
          skipDuplicates: true,
        });
      }
    }
    if (input.finalChunk === true) {
      if (catalog) {
        await tx.companyOsCodexTask.updateMany({
          where: { sourceHost, projectName: { notIn: [...catalog, UNASSIGNED_PROJECT] } },
          data: { projectName: UNASSIGNED_PROJECT },
        });
        await tx.companyOsCodexInventorySync.createMany({
          data: catalog.map((projectName) => ({
            id: `codex-project-catalog:${sourceHost}:${catalogHash}:${createHash('sha256').update(projectName).digest('hex')}`,
            sourceHost,
            scanId: projectName,
            observedCount: 0,
            changedCount: 0,
            completedAt: observedAt,
          })),
          skipDuplicates: true,
        });
      }
      const observedCount = Math.max(normalized.length, Math.trunc(Number(input.observedCount) || normalized.length));
      const totalChangedCount = Math.max(changedCount, Math.trunc(Number(input.changedBefore) || 0) + changedCount);
      const syncId = `codex-sync:${sourceHost}:${scanId}`;
      const existingSync = await tx.companyOsCodexInventorySync.findUnique({ where: { id: syncId } });
      if (!existingSync) await tx.companyOsCodexInventorySync.create({
        data: {
          id: syncId,
          sourceHost,
          scanId: catalogHash ? `${scanId}:catalog:${catalogHash}` : scanId,
          observedCount,
          changedCount: totalChangedCount,
          completedAt: observedAt,
        },
      });
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 25_000 });

  return { accepted: normalized.length, changedCount, scanId, actorRef, nativeProjectCount: catalog?.length ?? null };
}

export async function markCodexTaskDone(rawThreadId: unknown, actorRef: string) {
  const threadId = safeThreadId(rawThreadId);
  const db = companyOsV3Prisma();
  const task = await db.companyOsCodexTask.findUnique({ where: { threadId }, include: { boardState: true, actions: { orderBy: { newVersion: 'desc' }, take: 1 } } });
  if (!task) throw new CodexTaskStoreError('La tarea no existe', 404);
  const current = effectiveCodexTaskState(task, task.boardState);
  if (current.lifecycle === 'CLOSED' && current.humanStatus === 'DONE') {
    return { task: taskView(task), action: 'CLOSE', unchanged: true };
  }
  return manageCodexTask({
    threadId,
    action: 'CLOSE',
    idempotencyKey: `legacy:${randomUUID()}`,
    expectedFingerprint: task.fingerprint,
    expectedVersion: current.boardVersion,
    confirmed: true,
  }, actorRef);
}

type BoardLifecycle = 'OPEN' | 'CLOSED' | 'ARCHIVED';
type BoardStateLike = {
  workflowStatus: string;
  lifecycle: string;
  previousLifecycle: string | null;
  sourceFingerprint: string;
  projectNameOverride: string | null;
  version: number;
  updatedBy: string;
  updatedAt: Date;
} | null;
type TaskWithBoardState = Prisma.CompanyOsCodexTaskGetPayload<{ include: { boardState: true } }> & {
  actions?: Array<{ idempotencyKey: string; newVersion: number }>;
};
type DispatchCandidateLike = {
  archived: boolean;
  attentionReason: string | null;
  fingerprint: string;
  humanStatus: string;
  autonomyLevel: string;
  sourceStatus: string;
  boardState: null | {
    workflowStatus: string;
    lifecycle: string;
    sourceFingerprint: string;
    version: number;
    updatedBy: string;
  };
  actions: Array<{
    action: string;
    actorRef: string;
    idempotencyKey: string;
    newHumanStatus: string;
    newVersion: number;
  }>;
};

export function isApprovedCodexTaskDispatchCandidate(task: DispatchCandidateLike, machineActor = CODEX_AUTO_RESUME_ACTOR) {
  const board = task.boardState;
  const approval = task.actions[0];
  const humanApproval = board?.updatedBy !== machineActor
    && approval?.actorRef === board?.updatedBy
    && approval?.idempotencyKey.startsWith('dashboard:auto-resume:');
  const policyApproval = board?.updatedBy === machineActor
    && approval?.actorRef === machineActor
    && (approval?.idempotencyKey.startsWith('codex-auto:eligibility:')
      || approval?.idempotencyKey.startsWith('codex-auto:retry-'));
  return !task.archived
    && task.attentionReason == null
    && ['IDLE', 'NOT_LOADED'].includes(task.sourceStatus)
    && board?.workflowStatus === 'PENDING'
    && board.lifecycle === 'OPEN'
    && board.sourceFingerprint === task.fingerprint
    && approval?.newVersion === board.version
    && (humanApproval || policyApproval)
    && approval.newHumanStatus === 'PENDING'
    && ['MOVE', 'REOPEN'].includes(approval.action);
}

export function isAutonomousCodexTaskDispatchCandidate(task: DispatchCandidateLike) {
  const board = task.boardState;
  const sourceChanged = Boolean(board && board.lifecycle !== 'ARCHIVED' && board.sourceFingerprint !== task.fingerprint);
  return !task.archived
    && task.attentionReason == null
    && task.humanStatus === 'PENDING'
    && task.autonomyLevel === 'A1'
    && ['IDLE', 'NOT_LOADED'].includes(task.sourceStatus)
    && (!board || sourceChanged)
    && (!board || board.lifecycle !== 'ARCHIVED');
}

export function effectiveCodexTaskState(
  source: { humanStatus: string; archived: boolean; fingerprint?: string; projectName?: string },
  boardState: (Pick<NonNullable<BoardStateLike>, 'workflowStatus' | 'lifecycle' | 'sourceFingerprint' | 'projectNameOverride' | 'version'> & { updatedBy?: string }) | null,
) {
  const durableAutoResumeInProgress = boardState?.workflowStatus === 'IN_PROGRESS' && boardState.updatedBy === CODEX_AUTO_RESUME_ACTOR;
  const workflowDecisionIsStale = Boolean(
    boardState
    && boardState.lifecycle !== 'ARCHIVED'
    && source.fingerprint
    && boardState.sourceFingerprint !== source.fingerprint
    && !durableAutoResumeInProgress,
  );
  const humanStatus = workflowDecisionIsStale
    ? source.humanStatus
    : boardState?.workflowStatus ?? source.humanStatus;
  const sourceLifecycle: BoardLifecycle = source.archived
    ? 'ARCHIVED'
    : ['DONE', 'DISCARDED'].includes(humanStatus) ? 'CLOSED' : 'OPEN';
  const lifecycle = (boardState && !workflowDecisionIsStale && ['OPEN', 'CLOSED', 'ARCHIVED'].includes(boardState.lifecycle)
    ? boardState.lifecycle
    : sourceLifecycle) as BoardLifecycle;
  return {
    humanStatus,
    lifecycle,
    projectName: boardState?.projectNameOverride ?? source.projectName ?? 'Sin proyecto asignado',
    archived: lifecycle === 'ARCHIVED',
    boardVersion: boardState?.version ?? 0,
    changedSinceManaged: workflowDecisionIsStale,
  };
}

export async function manageCodexTask(raw: unknown, actorRef: string) {
  const input = record(raw);
  const threadId = safeThreadId(input.threadId);
  const action = enumValue(input.action, MANAGEMENT_ACTIONS, '');
  if (!action) throw new CodexTaskStoreError('Acción de gestión no permitida');
  const idempotencyKey = safeIdempotencyKey(input.idempotencyKey);
  const expectedFingerprint = safeFingerprint(input.expectedFingerprint);
  const expectedVersion = Math.trunc(Number(input.expectedVersion));
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw new CodexTaskStoreError('Versión de gestión inválida');
  const targetStatus = typeof input.targetStatus === 'string' ? input.targetStatus.trim().toUpperCase() : '';
  const targetProjectName = action === 'MOVE_PROJECT' ? canonicalProjectName(input.targetProjectName) : null;
  const safeActorRef = safeText(actorRef, 160);
  const requestHash = createHash('sha256').update(JSON.stringify({
    threadId,
    action,
    targetStatus: targetStatus || null,
    targetProjectName,
    confirmed: input.confirmed === true,
    expectedFingerprint,
    expectedVersion,
  })).digest('hex');
  const db = companyOsV3Prisma();

  try {
    return await db.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM public."CompanyOsCodexTask" WHERE id = ${`codex-task:${threadId}`} FOR UPDATE`);

      const existingAction = await tx.companyOsCodexTaskAction.findUnique({ where: { idempotencyKey } });
      if (existingAction) {
        if (existingAction.requestHash !== requestHash) throw new CodexTaskStoreError('La clave idempotente ya fue usada para otra acción', 409);
        const existingTask = await tx.companyOsCodexTask.findUnique({ where: { id: existingAction.taskId }, include: { boardState: true, actions: { orderBy: { newVersion: 'desc' }, take: 1 } } });
        if (!existingTask || existingTask.threadId !== threadId) throw new CodexTaskStoreError('La clave idempotente pertenece a otra tarea', 409);
        return { task: taskView(existingTask), action: existingAction.action, replay: existingAction.resultSnapshot, unchanged: true };
      }

      const task = await tx.companyOsCodexTask.findUnique({ where: { threadId }, include: { boardState: true, actions: { orderBy: { newVersion: 'desc' }, take: 1 } } });
      if (!task) throw new CodexTaskStoreError('La tarea no existe', 404);
      const current = effectiveCodexTaskState(task, task.boardState);
      const autoResumeRunning = Boolean(
        task.boardState
        && task.boardState.workflowStatus === 'IN_PROGRESS'
        && task.boardState.lifecycle === 'OPEN'
        && task.boardState.updatedBy === CODEX_AUTO_RESUME_ACTOR,
      );
      if (autoResumeRunning) throw new CodexTaskStoreError('Codex está ejecutando esta tarea; esperá a que termine o venza su límite de seguridad', 409);
      if (task.fingerprint !== expectedFingerprint || current.boardVersion !== expectedVersion) {
        throw new CodexTaskStoreError('La tarea cambió desde que la abriste. La ficha debe actualizarse antes de guardar.', 409);
      }

      let newHumanStatus = current.humanStatus;
      let newLifecycle = current.lifecycle;
      let newProjectName = current.projectName;

      if (action === 'MOVE') {
        if (current.lifecycle !== 'OPEN') throw new CodexTaskStoreError('La tarea no está abierta. Reabrila antes de moverla.', 409);
        if (!MANAGED_TARGET_STATUSES.has(targetStatus)) throw new CodexTaskStoreError('Destino de tarea no permitido');
        if (targetStatus === 'PENDING' && input.confirmed !== true) throw new CodexTaskStoreError('Confirmá explícitamente la reanudación automática');
        if (targetStatus === 'PENDING' && (task.archived || task.attentionReason || !['IDLE', 'NOT_LOADED'].includes(task.sourceStatus))) {
          throw new CodexTaskStoreError('La tarea está archivada, necesita una decisión o no está inactiva; no puede autorizarse automáticamente', 409);
        }
        newHumanStatus = targetStatus;
      } else if (action === 'MOVE_PROJECT') {
        if (!targetProjectName) throw new CodexTaskStoreError('Elegí un proyecto de destino');
        const latestInventory = await tx.companyOsCodexInventorySync.findFirst({
          where: { id: { startsWith: 'codex-sync:' } },
          orderBy: { completedAt: 'desc' },
          select: { sourceHost: true, scanId: true },
        });
        const latestCatalogHash = latestInventory ? catalogHashFromSync(latestInventory.scanId) : null;
        const projectExists = Boolean(latestInventory && latestCatalogHash && await tx.companyOsCodexInventorySync.findFirst({
          where: {
            id: { startsWith: `codex-project-catalog:${latestInventory.sourceHost}:${latestCatalogHash}:` },
            sourceHost: latestInventory.sourceHost,
            scanId: targetProjectName,
          },
          select: { id: true },
        }));
        if (!projectExists) throw new CodexTaskStoreError('El proyecto de destino ya no está disponible', 409);
        newProjectName = targetProjectName;
      } else if (action === 'ARCHIVE') {
        if (current.lifecycle === 'ARCHIVED') throw new CodexTaskStoreError('La tarea ya está archivada', 409);
        newLifecycle = 'ARCHIVED';
      } else if (action === 'CLOSE') {
        if (current.lifecycle !== 'OPEN' || current.humanStatus !== 'READY_REVIEW') throw new CodexTaskStoreError('Sólo una tarea lista para revisar puede cerrarse como realizada', 409);
        if (input.confirmed !== true) throw new CodexTaskStoreError('Confirmá que revisaste el resultado antes de cerrar');
        newHumanStatus = 'DONE';
        newLifecycle = 'CLOSED';
      } else if (action === 'REOPEN') {
        if (current.lifecycle === 'OPEN' && !['DONE', 'DISCARDED'].includes(current.humanStatus)) throw new CodexTaskStoreError('Esta tarea ya está abierta', 409);
        if (!REOPEN_TARGET_STATUSES.has(targetStatus)) throw new CodexTaskStoreError('Elegí si vuelve para el agente o necesita una decisión tuya');
        if (targetStatus === 'PENDING' && input.confirmed !== true) throw new CodexTaskStoreError('Confirmá explícitamente la reanudación automática');
        if (targetStatus === 'PENDING' && (task.archived || task.attentionReason || !['IDLE', 'NOT_LOADED'].includes(task.sourceStatus))) {
          throw new CodexTaskStoreError('La tarea está archivada, necesita una decisión o no está inactiva; no puede autorizarse automáticamente', 409);
        }
        newHumanStatus = targetStatus;
        newLifecycle = 'OPEN';
      }

      const newVersion = current.boardVersion + 1;
      const resultSnapshot = {
        threadId,
        humanStatus: newHumanStatus,
        lifecycle: newLifecycle,
        projectName: newProjectName,
        boardVersion: newVersion,
      };
      await tx.companyOsCodexTaskAction.create({
        data: {
          id: `codex-action:${randomUUID()}`,
          taskId: task.id,
          idempotencyKey,
          action,
          fingerprint: task.fingerprint,
          requestHash,
          previousVersion: current.boardVersion,
          newVersion,
          previousHumanStatus: current.humanStatus,
          newHumanStatus,
          previousLifecycle: current.lifecycle,
          newLifecycle,
          previousProjectName: current.projectName,
          newProjectName,
          resultSnapshot,
          actorRef: safeActorRef,
        },
      });
      const boardData = {
        workflowStatus: newHumanStatus,
        lifecycle: newLifecycle,
        previousLifecycle: current.lifecycle,
        sourceFingerprint: task.fingerprint,
        projectNameOverride: newProjectName === task.projectName ? null : newProjectName,
        updatedBy: safeActorRef,
      };
      if (task.boardState) {
        const updated = await tx.companyOsCodexTaskBoardState.updateMany({
          where: { taskId: task.id, version: expectedVersion },
          data: { ...boardData, version: { increment: 1 } },
        });
        if (updated.count !== 1) throw new CodexTaskStoreError('Otra acción actualizó la tarea. La ficha debe recargarse.', 409);
      } else {
        if (expectedVersion !== 0) throw new CodexTaskStoreError('La versión inicial de la tarea no coincide', 409);
        await tx.companyOsCodexTaskBoardState.create({ data: { taskId: task.id, ...boardData, version: newVersion } });
      }
      const updatedTask = await tx.companyOsCodexTask.findUniqueOrThrow({
        where: { id: task.id },
        include: { boardState: true, actions: { orderBy: { newVersion: 'desc' }, take: 1 } },
      });
      return { task: taskView(updatedTask), action, replay: resultSnapshot, unchanged: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 });
  } catch (error) {
    if (error instanceof CodexTaskStoreError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) {
      throw new CodexTaskStoreError('Otra acción modificó esta tarea. La ficha debe recargarse.', 409);
    }
    throw error;
  }
}

function taskView(task: TaskWithBoardState) {
  const effective = effectiveCodexTaskState(task, task.boardState);
  const reopened = Boolean(task.boardState && ['DONE', 'DISCARDED'].includes(task.humanStatus) && effective.lifecycle === 'OPEN');
  const lastActionKey = task.actions?.[0]?.idempotencyKey ?? '';
  const durableAutoResumeAuthorization = lastActionKey.startsWith('dashboard:auto-resume:')
    || lastActionKey.startsWith('codex-auto:eligibility:')
    || lastActionKey.startsWith('codex-auto:retry-');
  const autoResumeApproved = Boolean(
    task.boardState
    && task.boardState.workflowStatus === 'PENDING'
    && task.boardState.lifecycle === 'OPEN'
    && task.boardState.sourceFingerprint === task.fingerprint
    && !task.archived
    && task.attentionReason == null
    && ['IDLE', 'NOT_LOADED'].includes(task.sourceStatus)
    && task.actions?.[0]?.newVersion === task.boardState.version
    && durableAutoResumeAuthorization,
  );
  const autoResumeRunning = Boolean(
    task.boardState
    && task.boardState.workflowStatus === 'IN_PROGRESS'
    && task.boardState.lifecycle === 'OPEN'
    && task.boardState.updatedBy === CODEX_AUTO_RESUME_ACTOR,
  );
  const autoResumeFailure = lastActionKey.startsWith('codex-auto:report-failed:')
    ? 'La ejecución automática terminó con error.'
    : lastActionKey.startsWith('codex-auto:report-timed_out:')
      ? 'La ejecución automática superó el tiempo máximo.'
      : lastActionKey.startsWith('codex-auto:report-succeeded:')
        ? 'Codex terminó, pero el hilo no mostró un cambio verificable.'
        : lastActionKey.startsWith('codex-auto:stale:')
          ? 'La ejecución automática perdió su heartbeat y fue detenida por seguridad.'
          : null;
  return {
    threadId: task.threadId,
    title: task.title,
    projectName: effective.projectName,
    sourceProjectName: task.projectName,
    category: task.category,
    humanStatus: effective.humanStatus,
    sourceHumanStatus: task.humanStatus,
    sourceArchived: task.archived,
    lifecycle: effective.lifecycle,
    priority: task.priority,
    nextAction: effective.lifecycle === 'CLOSED'
      ? 'Realizada y validada por Diego.'
      : effective.humanStatus === 'BLOCKED' && autoResumeFailure
        ? 'Abrir la tarea, revisar el último intento y volver a autorizar sólo después de resolver la causa.'
      : reopened ? 'Retomar y definir el próximo resultado verificable.' : task.nextAction,
    attentionReason: effective.lifecycle === 'CLOSED'
      ? null
      : effective.humanStatus === 'NEEDS_DIEGO' && !task.attentionReason
        ? 'Necesita una decisión de Diego para continuar.'
        : effective.humanStatus === 'BLOCKED' && !task.attentionReason
          ? autoResumeFailure ?? 'La tarea quedó bloqueada y necesita revisión antes de continuar.'
        : task.attentionReason,
    autonomyLevel: autoResumeApproved || autoResumeRunning ? 'A1' : task.autonomyLevel,
    autoResumeApproved,
    autoResumeRunning,
    codexUrl: task.codexUrl,
    sourceStatus: task.sourceStatus,
    fingerprint: task.fingerprint,
    archived: effective.archived,
    boardVersion: effective.boardVersion,
    boardUpdatedAt: task.boardState?.updatedAt.toISOString() ?? null,
    changedSinceManaged: effective.changedSinceManaged,
    nativeMutationAvailable: false,
    sourceUpdatedAt: task.sourceUpdatedAt.toISOString(),
    lastCompletedAt: task.lastCompletedAt?.toISOString() ?? null,
    lastObservedAt: task.lastObservedAt.toISOString(),
  };
}

async function appendDispatchTransition(
  tx: Prisma.TransactionClient,
  task: TaskWithBoardState,
  nextHumanStatus: 'UNREVIEWED' | 'PENDING' | 'IN_PROGRESS' | 'NEEDS_DIEGO' | 'BLOCKED' | 'READY_REVIEW' | 'DONE' | 'MONITORING' | 'DISCARDED',
  actorRef: string,
  suffix: string,
  nextLifecycle: 'OPEN' | 'CLOSED' | 'ARCHIVED' = 'OPEN',
) {
  const current = effectiveCodexTaskState(task, task.boardState);
  const sourceChangedAfterBoardUpdate = Boolean(task.boardState
    && task.boardState.lifecycle !== 'ARCHIVED'
    && task.boardState.sourceFingerprint !== task.fingerprint);
  const transitionPreviousHumanStatus = sourceChangedAfterBoardUpdate ? task.humanStatus : current.humanStatus;
  const transitionPreviousLifecycle = sourceChangedAfterBoardUpdate
    ? task.archived ? 'ARCHIVED' : ['DONE', 'DISCARDED'].includes(task.humanStatus) ? 'CLOSED' : 'OPEN'
    : current.lifecycle;
  const newVersion = current.boardVersion + 1;
  const resultSnapshot = {
    threadId: task.threadId,
    humanStatus: nextHumanStatus,
    lifecycle: nextLifecycle,
    projectName: current.projectName,
    boardVersion: newVersion,
  };
  const requestHash = createHash('sha256').update(JSON.stringify({
    threadId: task.threadId,
    fingerprint: task.fingerprint,
    previousVersion: current.boardVersion,
    nextHumanStatus,
    nextLifecycle,
    actorRef,
    suffix,
  })).digest('hex');
  const idempotencyKey = `codex-auto:${suffix}:${requestHash}`;
  await tx.companyOsCodexTaskAction.create({
    data: {
      id: `codex-action:${randomUUID()}`,
      taskId: task.id,
      idempotencyKey,
      action: 'MOVE',
      fingerprint: task.fingerprint,
      requestHash,
      previousVersion: current.boardVersion,
      newVersion,
      previousHumanStatus: transitionPreviousHumanStatus,
      newHumanStatus: nextHumanStatus,
      previousLifecycle: transitionPreviousLifecycle,
      newLifecycle: nextLifecycle,
      previousProjectName: current.projectName,
      newProjectName: current.projectName,
      resultSnapshot,
      actorRef,
    },
  });
  const boardData = {
    workflowStatus: nextHumanStatus,
    lifecycle: nextLifecycle,
    previousLifecycle: current.lifecycle,
    sourceFingerprint: task.fingerprint,
    projectNameOverride: current.projectName === task.projectName ? null : current.projectName,
    updatedBy: actorRef,
  };
  if (task.boardState) {
    const updated = await tx.companyOsCodexTaskBoardState.updateMany({
      where: { taskId: task.id, version: current.boardVersion },
      data: { ...boardData, version: { increment: 1 } },
    });
    if (updated.count !== 1) throw new CodexTaskStoreError('Otra acción tomó esta tarea antes que el agente', 409);
  } else {
    await tx.companyOsCodexTaskBoardState.create({ data: { taskId: task.id, ...boardData, version: newVersion } });
  }
  return resultSnapshot;
}

export async function claimApprovedCodexTask(raw: unknown, actorRef: string) {
  const input = record(raw);
  const sourceHost = safeText(input.sourceHost, 120);
  const instanceId = safeText(input.instanceId, 200);
  const claimToken = safeDispatchToken(input.claimToken);
  const binding = dispatchBinding(sourceHost, instanceId, claimToken);
  const claimKeyPrefix = `codex-auto:claim-${binding}:`;
  const safeActorRef = safeText(actorRef, 160);
  const db = companyOsV3Prisma();
  try {
    return await db.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`company-os-codex-dispatch:${sourceHost}`}))`);
      const replayAction = await tx.companyOsCodexTaskAction.findFirst({
        where: {
          actorRef: safeActorRef,
          newHumanStatus: 'IN_PROGRESS',
          idempotencyKey: { startsWith: claimKeyPrefix },
        },
        include: { task: { include: { boardState: true } } },
        orderBy: { createdAt: 'asc' },
      });
      if (replayAction?.task.boardState
        && replayAction.task.sourceHost === sourceHost
        && replayAction.task.boardState.version === replayAction.newVersion
        && replayAction.task.boardState.workflowStatus === 'IN_PROGRESS'
        && replayAction.task.boardState.updatedBy === safeActorRef) {
        if (replayAction.task.fingerprint !== replayAction.fingerprint) {
          const sourceArchived = replayAction.task.archived || replayAction.task.sourceStatus === 'ARCHIVED';
          await appendDispatchTransition(tx, replayAction.task, sourceArchived ? 'DISCARDED' : 'UNREVIEWED', safeActorRef, 'source-changed', sourceArchived ? 'ARCHIVED' : 'OPEN');
          return { claimed: false, replay: true, reconciled: true, reason: 'CLAIM_SOURCE_CHANGED', activeThreadId: replayAction.task.threadId };
        }
        const replayBaseline = claimBaselineFromKey(replayAction.idempotencyKey, claimKeyPrefix);
        if (!replayBaseline.valid) throw new CodexTaskStoreError('El claim durable no contiene un baseline válido', 409);
        return {
          claimed: true,
          replay: true,
          reason: 'APPROVED_TASK_CLAIM_REPLAYED',
          dispatch: {
            threadId: replayAction.task.threadId,
            fingerprint: replayAction.fingerprint,
            title: replayAction.task.title,
            projectName: effectiveCodexTaskState(replayAction.task, replayAction.task.boardState).projectName,
            sourceProjectName: replayAction.task.projectName,
            boardVersion: replayAction.newVersion,
            lastCompletedAt: replayBaseline.value?.toISOString() ?? null,
          },
        };
      }
      if (replayAction) {
        return { claimed: false, replay: true, reason: 'CLAIM_ALREADY_CONSUMED', activeThreadId: replayAction.task.threadId };
      }
      const active = await tx.companyOsCodexTask.findFirst({
        where: {
          sourceHost,
          archived: false,
          boardState: { is: { workflowStatus: 'IN_PROGRESS', lifecycle: 'OPEN', updatedBy: safeActorRef } },
        },
        include: { boardState: true },
        orderBy: { sourceUpdatedAt: 'asc' },
      });
      if (active?.boardState) {
        if (Date.now() - active.boardState.updatedAt.getTime() <= CODEX_AUTO_RESUME_STALE_MS) {
          return { claimed: false, reason: 'DISPATCH_ALREADY_ACTIVE', activeThreadId: active.threadId };
        } else {
          await appendDispatchTransition(tx, active, 'BLOCKED', safeActorRef, 'stale');
          return { claimed: false, reason: 'STALE_DISPATCH_BLOCKED', activeThreadId: active.threadId };
        }
      }

      const candidates = await tx.companyOsCodexTask.findMany({
        where: {
          sourceHost,
          archived: false,
          attentionReason: null,
          sourceStatus: { in: ['IDLE', 'NOT_LOADED'] },
          OR: [
            { boardState: { is: { workflowStatus: 'PENDING', lifecycle: 'OPEN' } } },
            { humanStatus: 'PENDING', autonomyLevel: 'A1' },
          ],
        },
        include: {
          boardState: true,
          actions: { orderBy: { newVersion: 'desc' }, take: 1 },
        },
        orderBy: [{ priority: 'asc' }, { sourceUpdatedAt: 'desc' }],
        take: 2_000,
      });
      const humanCandidate = candidates.find((task) => isApprovedCodexTaskDispatchCandidate(task, safeActorRef));
      const autonomousCandidate = candidates.find((task) => isAutonomousCodexTaskDispatchCandidate(task));
      let candidate = humanCandidate ?? autonomousCandidate;
      if (!candidate) return { claimed: false, reason: 'NO_APPROVED_TASK' };
      if (!humanCandidate) {
        await appendDispatchTransition(tx, candidate, 'PENDING', safeActorRef, 'eligibility');
        candidate = await tx.companyOsCodexTask.findUniqueOrThrow({
          where: { id: candidate.id },
          include: { boardState: true, actions: { orderBy: { newVersion: 'desc' }, take: 1 } },
        });
        if (!isApprovedCodexTaskDispatchCandidate(candidate, safeActorRef)) {
          throw new CodexTaskStoreError('La elegibilidad autónoma no quedó persistida', 409);
        }
      }
      const baselineToken = claimBaselineToken(candidate.lastCompletedAt);
      const snapshot = await appendDispatchTransition(tx, candidate, 'IN_PROGRESS', safeActorRef, `claim-${binding}:${baselineToken}`);
      return {
        claimed: true,
        reason: 'APPROVED_TASK_CLAIMED',
        dispatch: {
          threadId: candidate.threadId,
          fingerprint: candidate.fingerprint,
          title: candidate.title,
          projectName: effectiveCodexTaskState(candidate, candidate.boardState).projectName,
          sourceProjectName: candidate.projectName,
          boardVersion: snapshot.boardVersion,
          lastCompletedAt: candidate.lastCompletedAt?.toISOString() ?? null,
        },
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 });
  } catch (error) {
    if (error instanceof CodexTaskStoreError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) {
      throw new CodexTaskStoreError('Otra instancia actualizó el despacho; se reintentará en el próximo ciclo', 409);
    }
    throw error;
  }
}

export async function reportCodexTaskDispatch(raw: unknown, actorRef: string) {
  const input = record(raw);
  const sourceHost = safeText(input.sourceHost, 120);
  const instanceId = safeText(input.instanceId, 200);
  const claimToken = safeDispatchToken(input.claimToken);
  const binding = dispatchBinding(sourceHost, instanceId, claimToken);
  const claimKeyPrefix = `codex-auto:claim-${binding}:`;
  const threadId = safeThreadId(input.threadId);
  const claimedFingerprint = safeFingerprint(input.fingerprint);
  const claimedLastCompletedAt = input.claimedLastCompletedAt == null ? null : nullableDate(input.claimedLastCompletedAt);
  const outcome = enumValue(input.outcome, new Set(['SUCCEEDED', 'FAILED', 'TIMED_OUT']), '');
  if (!outcome) throw new CodexTaskStoreError('Resultado de reanudación inválido');
  const safeActorRef = safeText(actorRef, 160);
  const db = companyOsV3Prisma();
  return db.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`company-os-codex-dispatch:${sourceHost}`}))`);
    const task = await tx.companyOsCodexTask.findUnique({
      where: { threadId },
      include: { boardState: true, actions: { orderBy: { newVersion: 'desc' }, take: 1 } },
    });
    if (!task || task.sourceHost !== sourceHost) throw new CodexTaskStoreError('La tarea reportada no pertenece a este host', 404);
    if (!task.boardState
      || task.boardState.workflowStatus !== 'IN_PROGRESS'
      || task.boardState.updatedBy !== safeActorRef
      || task.actions[0]?.newVersion !== task.boardState.version
      || !task.actions[0].idempotencyKey.startsWith(claimKeyPrefix)) {
      return { reported: true, changed: false, outcome, reason: 'DISPATCH_STATE_CHANGED' };
    }
    const claimAction = task.actions[0];
    const durableBaseline = claimBaselineFromKey(claimAction.idempotencyKey, claimKeyPrefix);
    if (!durableBaseline.valid
      || claimedFingerprint !== claimAction.fingerprint
      || (claimedLastCompletedAt?.toISOString() ?? null) !== (durableBaseline.value?.toISOString() ?? null)) {
      throw new CodexTaskStoreError('El reporte no coincide con el claim durable', 409);
    }
    if (task.archived || task.sourceStatus === 'ARCHIVED') {
      await appendDispatchTransition(tx, task, 'DISCARDED', safeActorRef, 'source-archived', 'ARCHIVED');
      return { reported: true, changed: true, verifiedCompletion: false, outcome, humanStatus: 'DISCARDED', lifecycle: 'ARCHIVED', reason: 'SOURCE_ARCHIVED' };
    }
    const completedAfterClaim = Boolean(
      task.lastCompletedAt
      && (!claimedLastCompletedAt || task.lastCompletedAt > claimedLastCompletedAt)
      && task.fingerprint !== claimedFingerprint
      && task.sourceStatus !== 'ACTIVE',
    );
    if (outcome === 'SUCCEEDED' && completedAfterClaim) {
      const verifiedStatus = ['UNREVIEWED', 'NEEDS_DIEGO', 'BLOCKED', 'READY_REVIEW', 'MONITORING'].includes(task.humanStatus)
        ? task.humanStatus as 'UNREVIEWED' | 'NEEDS_DIEGO' | 'BLOCKED' | 'READY_REVIEW' | 'MONITORING'
        : 'UNREVIEWED';
      if (verifiedStatus === 'READY_REVIEW' && task.autonomyLevel === 'A1') {
        await appendDispatchTransition(tx, task, 'DONE', safeActorRef, 'complete-verified', 'CLOSED');
        return { reported: true, changed: true, verifiedCompletion: true, outcome, humanStatus: 'DONE', lifecycle: 'CLOSED' };
      }
      await appendDispatchTransition(tx, task, verifiedStatus, safeActorRef, 'complete');
      return { reported: true, changed: true, verifiedCompletion: true, outcome, humanStatus: verifiedStatus };
    }
    const terminalBlocker = task.fingerprint !== claimedFingerprint
      && task.sourceStatus !== 'ACTIVE'
      && ['NEEDS_DIEGO', 'BLOCKED'].includes(task.humanStatus);
    if (terminalBlocker) {
      const terminalStatus = task.humanStatus as 'NEEDS_DIEGO' | 'BLOCKED';
      await appendDispatchTransition(tx, task, terminalStatus, safeActorRef, `terminal-${terminalStatus.toLowerCase()}`);
      return {
        reported: true,
        changed: true,
        verifiedCompletion: false,
        outcome,
        humanStatus: terminalStatus,
        reason: terminalStatus === 'NEEDS_DIEGO' ? 'NEEDS_USER' : 'BLOCKED_EXTERNAL',
      };
    }
    const executionSeriesStart = await tx.companyOsCodexTaskAction.findFirst({
      where: {
        taskId: task.id,
        createdAt: { lte: claimAction.createdAt },
        OR: [
          { idempotencyKey: { startsWith: 'dashboard:auto-resume:' } },
          { idempotencyKey: { startsWith: 'codex-auto:eligibility:' } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
    const failureCount = await tx.companyOsCodexTaskAction.count({
      where: {
        taskId: task.id,
        idempotencyKey: { startsWith: 'codex-auto:retry-' },
        ...(executionSeriesStart ? { createdAt: { gte: executionSeriesStart.createdAt } } : {}),
      },
    });
    if (outcome !== 'SUCCEEDED' && failureCount < CODEX_AUTO_RESUME_MAX_FAILURES - 1) {
      const retryAttempt = failureCount + 1;
      await appendDispatchTransition(tx, task, 'PENDING', safeActorRef, `retry-${retryAttempt}-${outcome.toLowerCase()}`);
      return {
        reported: true,
        changed: task.fingerprint !== claimedFingerprint,
        verifiedCompletion: false,
        outcome,
        humanStatus: 'PENDING',
        reason: 'SAFE_RETRY_SCHEDULED',
        retryAttempt,
      };
    }
    await appendDispatchTransition(tx, task, 'BLOCKED', safeActorRef, `report-${outcome.toLowerCase()}`);
    return {
      reported: true,
      changed: task.fingerprint !== claimedFingerprint,
      verifiedCompletion: false,
      outcome,
      humanStatus: 'BLOCKED',
      reason: outcome === 'SUCCEEDED' ? 'NO_VERIFIABLE_COMPLETION' : 'EXECUTION_DID_NOT_SUCCEED',
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 });
}

export async function getHumanWorkCenter() {
  const db = companyOsV3Prisma();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [tasks, lastSync, recentChanges] = await Promise.all([
    db.companyOsCodexTask.findMany({
      include: { boardState: true, actions: { orderBy: { newVersion: 'desc' }, take: 1 } },
      orderBy: [{ priority: 'asc' }, { sourceUpdatedAt: 'desc' }],
    }),
    db.companyOsCodexInventorySync.findFirst({
      where: { id: { startsWith: 'codex-sync:' } },
      orderBy: { completedAt: 'desc' },
    }),
    db.companyOsCodexTaskObservation.count({ where: { observedAt: { gte: today } } }),
  ]);
  let commercialProducts: Array<{ sku: string; name: string; stock: number; last_purchase_cost: unknown; lp1: unknown; updatedAt: Date }> = [];
  let commercialReadiness: null | { withStock: number; missingCost: number; missingPrice: number } = null;
  let commercialUnavailable = false;
  try {
    const businessDb = companyReadPrisma();
    commercialProducts = await businessDb.product.findMany({
      where: { active: true, stock: { gt: 0 }, last_purchase_cost: { gt: 0 }, lp1: { gt: 0 } },
      select: { sku: true, name: true, stock: true, last_purchase_cost: true, lp1: true, updatedAt: true },
      orderBy: [{ updatedAt: 'desc' }],
      take: 20,
    });
    const withStock = await businessDb.product.count({ where: { active: true, stock: { gt: 0 } } });
    const missingCost = await businessDb.product.count({ where: { active: true, stock: { gt: 0 }, OR: [{ last_purchase_cost: null }, { last_purchase_cost: { lte: 0 } }] } });
    const missingPrice = await businessDb.product.count({ where: { active: true, stock: { gt: 0 }, OR: [{ lp1: null }, { lp1: { lte: 0 } }] } });
    commercialReadiness = { withStock, missingCost, missingPrice };
  } catch {
    commercialUnavailable = true;
  }
  const currentCatalogHash = lastSync ? catalogHashFromSync(lastSync.scanId) : null;
  const currentCatalogRows = lastSync && currentCatalogHash ? await db.companyOsCodexInventorySync.findMany({
    where: {
      id: { startsWith: `codex-project-catalog:${lastSync.sourceHost}:${currentCatalogHash}:` },
      sourceHost: lastSync.sourceHost,
    },
    select: { scanId: true },
  }) : [];
  const currentCatalog = new Set(currentCatalogRows.map((row) => row.scanId).filter(isCanonicalProjectName));
  const fallbackCatalog = tasks.reduce((names, task) => {
    if (isCanonicalProjectName(task.projectName)) names.add(task.projectName);
    return names;
  }, new Set<string>());
  const nativeNames = currentCatalog.size ? currentCatalog : fallbackCatalog;
  const taskViews = tasks.map((task) => {
    const view = taskView(task);
    const projectName = nativeNames.has(view.projectName)
      ? view.projectName
      : nativeNames.has(task.projectName) ? task.projectName : UNASSIGNED_PROJECT;
    return { ...view, projectName };
  });
  const activeTasks = taskViews.filter((task) => task.lifecycle !== 'ARCHIVED');
  const archivedTasks = taskViews.filter((task) => task.lifecycle === 'ARCHIVED');
  const approvedPendingTasks = activeTasks.filter((task) => task.humanStatus === 'PENDING' && task.autoResumeApproved);
  const unapprovedTasks = activeTasks.filter((task) => task.humanStatus === 'UNREVIEWED' || (task.humanStatus === 'PENDING' && !task.autoResumeApproved));
  const byStatus = new Map<string, number>();
  for (const task of activeTasks) byStatus.set(task.humanStatus, (byStatus.get(task.humanStatus) ?? 0) + 1);
  const projects = Array.from(taskViews.reduce((projectCounts, task) => {
    projectCounts.set(task.projectName, (projectCounts.get(task.projectName) ?? 0) + 1);
    return projectCounts;
  }, new Map<string, number>([...nativeNames].map((name) => [name, 0])))).map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
  const commercialIdeas = commercialProducts
    .map((product) => {
      const cost = Number(product.last_purchase_cost);
      const price = Number(product.lp1);
      const marginPct = price > 0 ? Math.round(((price - cost) / price) * 1000) / 10 : 0;
      return {
        sku: product.sku,
        product: product.name,
        stock: product.stock,
        costUsd: cost,
        suggestedPriceUsd: price,
        marginPct,
        reason: `Hay ${product.stock} en stock y el precio sugerido usa la lista LP1 vigente.`,
        evidence: 'Stock, último costo y LP1 del catálogo operativo',
        observedAt: product.updatedAt.toISOString(),
      };
    })
    .filter((idea) => idea.marginPct > 0)
    .sort((a, b) => b.marginPct - a.marginPct)
    .slice(0, 5);

  const select = (statuses: string[]) => activeTasks.filter((task) => statuses.includes(task.humanStatus));
  const commercialNextAction = commercialUnavailable
    ? { title: 'No pude leer stock y precios en este momento', detail: 'Las tareas de Codex siguen disponibles. Reintentá la lectura comercial desde Artículos.', href: '/products' }
    : commercialIdeas.length ? null : commercialProducts.length
    ? { title: 'Revisar precios sin margen positivo', detail: `${commercialProducts.length} productos tienen stock, costo y LP1, pero ese precio no supera el costo con margen positivo.`, href: '/products' }
    : commercialReadiness?.withStock === 0
    ? { title: 'Primero falta cargar stock disponible', detail: 'Sin unidades disponibles no propongo una oferta que después no se pueda cumplir.', href: '/products' }
    : {
      title: 'Completar datos antes de ofrecer',
      detail: `${commercialReadiness?.withStock ?? 0} productos tienen stock; ${commercialReadiness?.missingCost ?? 0} necesitan costo y ${commercialReadiness?.missingPrice ?? 0} necesitan precio LP1.`,
      href: '/products',
    };
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      inProgress: byStatus.get('IN_PROGRESS') ?? 0,
      unreviewed: unapprovedTasks.length,
      pending: approvedPendingTasks.length,
      needsDiego: byStatus.get('NEEDS_DIEGO') ?? 0,
      blocked: byStatus.get('BLOCKED') ?? 0,
      readyReview: byStatus.get('READY_REVIEW') ?? 0,
      done: byStatus.get('DONE') ?? 0,
      monitoring: byStatus.get('MONITORING') ?? 0,
      archived: archivedTasks.length,
      total: activeTasks.length,
    },
    now: select(['IN_PROGRESS']),
    unreviewed: unapprovedTasks,
    pending: approvedPendingTasks,
    needsDiego: select(['NEEDS_DIEGO']),
    blocked: select(['BLOCKED']),
    readyReview: select(['READY_REVIEW']),
    done: select(['DONE']),
    monitoring: select(['MONITORING']),
    archived: archivedTasks,
    projects,
    commercialIdeas,
    commercialNextAction,
    activity: lastSync ? {
      sourceHost: lastSync.sourceHost,
      lastScanAt: lastSync.completedAt.toISOString(),
      observedCount: lastSync.observedCount,
      changedInLastScan: lastSync.changedCount,
      changesToday: recentChanges,
      fresh: Date.now() - lastSync.completedAt.getTime() < 20 * 60_000,
      autoResumeEnabled: lastSync.scanId.startsWith('auto-'),
    } : null,
  };
}
