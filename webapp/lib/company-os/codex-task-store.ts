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

function taskInput(raw: unknown, sourceHost: string, observedAt: Date) {
  const input = record(raw);
  const threadId = safeThreadId(input.threadId);
  const humanStatus = enumValue(input.humanStatus, HUMAN_STATUSES, 'UNREVIEWED');
  const sourceStatus = enumValue(input.sourceStatus, SOURCE_STATUSES, 'UNKNOWN');
  const category = enumValue(input.category, CATEGORIES, 'GENERAL');
  const autonomyLevel = enumValue(input.autonomyLevel, AUTONOMY_LEVELS, 'A0');
  const priority = Math.min(5, Math.max(1, Math.trunc(Number(input.priority) || 3)));
  const archived = input.archived === true;
  return {
    id: `codex-task:${threadId}`,
    threadId,
    sourceHost,
    title: safeText(input.title, 240, 'Tarea Codex sin título'),
    projectName: safeText(input.projectName, 160, 'Sin proyecto asignado'),
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
  const normalized = tasks.map((task) => taskInput(task, sourceHost, observedAt));
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
        await tx.companyOsCodexTaskObservation.create({
          data: {
            id: `codex-observation:${randomUUID()}`,
            taskId: task.id,
            fingerprint: task.fingerprint,
            humanStatus: task.humanStatus,
            sourceStatus: task.sourceStatus,
            actorRef,
            observedAt,
          },
        });
      }
    }
    if (input.finalChunk === true) {
      const observedCount = Math.max(normalized.length, Math.trunc(Number(input.observedCount) || normalized.length));
      const totalChangedCount = Math.max(changedCount, Math.trunc(Number(input.changedBefore) || 0) + changedCount);
      const syncId = `codex-sync:${sourceHost}:${scanId}`;
      const existingSync = await tx.companyOsCodexInventorySync.findUnique({ where: { id: syncId } });
      if (!existingSync) await tx.companyOsCodexInventorySync.create({
        data: {
          id: syncId,
          sourceHost,
          scanId,
          observedCount,
          changedCount: totalChangedCount,
          completedAt: observedAt,
        },
      });
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 25_000 });

  return { accepted: normalized.length, changedCount, scanId, actorRef };
}

export async function markCodexTaskDone(rawThreadId: unknown, actorRef: string) {
  const threadId = safeThreadId(rawThreadId);
  const db = companyOsV3Prisma();
  const task = await db.companyOsCodexTask.findUnique({ where: { threadId }, include: { boardState: true } });
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
type TaskWithBoardState = Prisma.CompanyOsCodexTaskGetPayload<{ include: { boardState: true } }>;

export function effectiveCodexTaskState(
  source: { humanStatus: string; archived: boolean; fingerprint?: string; projectName?: string },
  boardState: Pick<NonNullable<BoardStateLike>, 'workflowStatus' | 'lifecycle' | 'sourceFingerprint' | 'projectNameOverride' | 'version'> | null,
) {
  const workflowDecisionIsStale = Boolean(
    boardState
    && boardState.lifecycle !== 'ARCHIVED'
    && source.fingerprint
    && boardState.sourceFingerprint !== source.fingerprint,
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
  const targetProjectName = action === 'MOVE_PROJECT' ? safeText(input.targetProjectName, 160) : null;
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
        const existingTask = await tx.companyOsCodexTask.findUnique({ where: { id: existingAction.taskId }, include: { boardState: true } });
        if (!existingTask || existingTask.threadId !== threadId) throw new CodexTaskStoreError('La clave idempotente pertenece a otra tarea', 409);
        return { task: taskView(existingTask), action: existingAction.action, replay: existingAction.resultSnapshot, unchanged: true };
      }

      const task = await tx.companyOsCodexTask.findUnique({ where: { threadId }, include: { boardState: true } });
      if (!task) throw new CodexTaskStoreError('La tarea no existe', 404);
      const current = effectiveCodexTaskState(task, task.boardState);
      if (task.fingerprint !== expectedFingerprint || current.boardVersion !== expectedVersion) {
        throw new CodexTaskStoreError('La tarea cambió desde que la abriste. La ficha debe actualizarse antes de guardar.', 409);
      }

      let newHumanStatus = current.humanStatus;
      let newLifecycle = current.lifecycle;
      let newProjectName = current.projectName;

      if (action === 'MOVE') {
        if (current.lifecycle !== 'OPEN') throw new CodexTaskStoreError('La tarea no está abierta. Reabrila antes de moverla.', 409);
        if (!MANAGED_TARGET_STATUSES.has(targetStatus)) throw new CodexTaskStoreError('Destino de tarea no permitido');
        newHumanStatus = targetStatus;
      } else if (action === 'MOVE_PROJECT') {
        if (!targetProjectName) throw new CodexTaskStoreError('Elegí un proyecto de destino');
        const projectExists = targetProjectName === current.projectName || Boolean(await tx.companyOsCodexTask.findFirst({
          where: {
            OR: [
              { projectName: targetProjectName },
              { boardState: { is: { projectNameOverride: targetProjectName } } },
            ],
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
      const updatedBoard = await tx.companyOsCodexTaskBoardState.findUniqueOrThrow({ where: { taskId: task.id } });
      return { task: taskView({ ...task, boardState: updatedBoard }), action, replay: resultSnapshot, unchanged: false };
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
  return {
    threadId: task.threadId,
    title: task.title,
    projectName: effective.projectName,
    sourceProjectName: task.projectName,
    category: task.category,
    humanStatus: effective.humanStatus,
    sourceHumanStatus: task.humanStatus,
    lifecycle: effective.lifecycle,
    priority: task.priority,
    nextAction: effective.lifecycle === 'CLOSED'
      ? 'Realizada y validada por Diego.'
      : reopened ? 'Retomar y definir el próximo resultado verificable.' : task.nextAction,
    attentionReason: effective.lifecycle === 'CLOSED'
      ? null
      : effective.humanStatus === 'NEEDS_DIEGO' && !task.attentionReason
        ? 'Necesita una decisión de Diego para continuar.'
        : task.attentionReason,
    autonomyLevel: task.autonomyLevel,
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

export async function getHumanWorkCenter() {
  const db = companyOsV3Prisma();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [tasks, lastSync, recentChanges] = await Promise.all([
    db.companyOsCodexTask.findMany({
      include: { boardState: true },
      orderBy: [{ priority: 'asc' }, { sourceUpdatedAt: 'desc' }],
    }),
    db.companyOsCodexInventorySync.findFirst({ orderBy: { completedAt: 'desc' } }),
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
  const taskViews = tasks.map(taskView);
  const activeTasks = taskViews.filter((task) => task.lifecycle !== 'ARCHIVED');
  const archivedTasks = taskViews.filter((task) => task.lifecycle === 'ARCHIVED');
  const byStatus = new Map<string, number>();
  for (const task of activeTasks) byStatus.set(task.humanStatus, (byStatus.get(task.humanStatus) ?? 0) + 1);
  const projects = Array.from(taskViews.reduce((projectCounts, task) => {
    projectCounts.set(task.projectName, (projectCounts.get(task.projectName) ?? 0) + 1);
    return projectCounts;
  }, new Map<string, number>())).map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
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
      unreviewed: byStatus.get('UNREVIEWED') ?? 0,
      pending: byStatus.get('PENDING') ?? 0,
      needsDiego: byStatus.get('NEEDS_DIEGO') ?? 0,
      blocked: byStatus.get('BLOCKED') ?? 0,
      readyReview: byStatus.get('READY_REVIEW') ?? 0,
      done: byStatus.get('DONE') ?? 0,
      monitoring: byStatus.get('MONITORING') ?? 0,
      archived: archivedTasks.length,
      total: activeTasks.length,
    },
    now: select(['IN_PROGRESS']),
    pending: select(['PENDING', 'UNREVIEWED']),
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
    } : null,
  };
}
