import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { sanitizeCompanyText } from './objective';
import { companyOsV3Prisma } from './v3-prisma';

const HUMAN_STATUSES = new Set(['UNREVIEWED', 'PENDING', 'IN_PROGRESS', 'NEEDS_DIEGO', 'BLOCKED', 'READY_REVIEW', 'DONE', 'MONITORING', 'DISCARDED']);
const SOURCE_STATUSES = new Set(['ACTIVE', 'IDLE', 'NOT_LOADED', 'ARCHIVED', 'UNKNOWN']);
const CATEGORIES = new Set(['GENERAL', 'SYSTEMS', 'OPERATIONS', 'COMMERCIAL', 'FINANCE', 'CUSTOMERS', 'PERSONAL', 'MONITOR']);
const AUTONOMY_LEVELS = new Set(['A0', 'A1', 'A2', 'HUMAN']);

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
  const source = typeof value === 'string' ? value : '';
  const safe = sanitizeCompanyText(source, max).safeText.trim();
  if (safe) return safe;
  if (fallback) return fallback;
  throw new CodexTaskStoreError('Texto Codex obligatorio ausente');
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
  const threadId = safeText(input.threadId, 128);
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(threadId)) throw new CodexTaskStoreError('threadId Codex inválido');
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
  if (!tasks.length || tasks.length > 100) throw new CodexTaskStoreError('Cada lote debe contener entre 1 y 100 tareas');
  const observedAt = isoDate(input.observedAt, new Date());
  const normalized = tasks.map((task) => taskInput(task, sourceHost, observedAt));
  const db = companyOsV3Prisma();
  let changedCount = 0;

  await db.$transaction(async (tx) => {
    for (const task of normalized) {
      const previous = await tx.companyOsCodexTask.findUnique({ where: { threadId: task.threadId }, select: { fingerprint: true } });
      if (!previous || previous.fingerprint !== task.fingerprint) changedCount += 1;
      await tx.companyOsCodexTask.upsert({
        where: { threadId: task.threadId },
        update: task,
        create: task,
      });
      if (!previous || previous.fingerprint !== task.fingerprint) {
        await tx.companyOsCodexTaskObservation.create({
          data: {
            id: `codex-observation:${randomUUID()}`,
            taskId: task.id,
            fingerprint: task.fingerprint,
            humanStatus: task.humanStatus,
            sourceStatus: task.sourceStatus,
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

function taskView(task: {
  threadId: string; title: string; projectName: string; category: string; humanStatus: string;
  priority: number; nextAction: string; attentionReason: string | null; autonomyLevel: string;
  codexUrl: string; sourceUpdatedAt: Date; lastCompletedAt: Date | null; lastObservedAt: Date;
}) {
  return {
    ...task,
    sourceUpdatedAt: task.sourceUpdatedAt.toISOString(),
    lastCompletedAt: task.lastCompletedAt?.toISOString() ?? null,
    lastObservedAt: task.lastObservedAt.toISOString(),
  };
}

export async function getHumanWorkCenter() {
  const db = companyOsV3Prisma();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [tasks, counts, lastSync, recentChanges, commercialProducts] = await Promise.all([
    db.companyOsCodexTask.findMany({
      where: { archived: false },
      orderBy: [{ priority: 'asc' }, { sourceUpdatedAt: 'desc' }],
      take: 500,
    }),
    db.companyOsCodexTask.groupBy({ by: ['humanStatus'], where: { archived: false }, _count: { _all: true } }),
    db.companyOsCodexInventorySync.findFirst({ orderBy: { completedAt: 'desc' } }),
    db.companyOsCodexTaskObservation.count({ where: { observedAt: { gte: today } } }),
    prisma.product.findMany({
      where: { active: true, stock: { gt: 0 }, last_purchase_cost: { gt: 0 }, lp1: { gt: 0 } },
      select: { sku: true, name: true, stock: true, last_purchase_cost: true, lp1: true, updatedAt: true },
      orderBy: [{ updatedAt: 'desc' }],
      take: 20,
    }),
  ]);
  const byStatus = new Map(counts.map((row) => [row.humanStatus, row._count._all]));
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

  const select = (statuses: string[], limit: number) => tasks.filter((task) => statuses.includes(task.humanStatus)).slice(0, limit).map(taskView);
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
      total: counts.reduce((sum, row) => sum + row._count._all, 0),
    },
    now: select(['IN_PROGRESS'], 5),
    pending: select(['PENDING', 'UNREVIEWED'], 40),
    needsDiego: select(['NEEDS_DIEGO'], 20),
    blocked: select(['BLOCKED'], 20),
    readyReview: select(['READY_REVIEW'], 20),
    done: select(['DONE'], 20),
    monitoring: select(['MONITORING'], 10),
    commercialIdeas,
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
