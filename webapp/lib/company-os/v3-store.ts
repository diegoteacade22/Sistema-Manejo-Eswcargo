import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type CompanyOsCase } from '@prisma/client';
import { buildCompanySnapshot } from './live-snapshot';
import { sanitizeCompanyObjective } from './objective';
import { signCompanyOsWorkerPayload } from './v3-auth';
import { companyOsV3Prisma } from './v3-prisma';
import {
  COMPANY_OS_MISSION_STATUSES,
  COMPANY_OS_REQUEST_STATUSES,
  companyOsV3BudgetConfig,
  type CompanyOsMissionStatus,
  type CompanyOsRequestStatus,
  type CompanyOsWorkerResult,
  type CompanyOsWorkerUsage,
} from './v3-types';

const LEASE_MS = 4 * 60 * 1000;
const WORKER_REF = 'hostinger-company-os-v3';
const GLOBAL_LOCK_ID = '__COMPANY_OS_V3_GLOBAL__';
const TERMINAL_REQUEST_STATUSES = new Set<CompanyOsRequestStatus>(['FAILED', 'CANCELLED', 'COMPLETED']);

type Tx = Prisma.TransactionClient;
type Identity = { authMode: string; actorRef: string };

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function estimateTokens(value: unknown) {
  return Math.ceil(Buffer.byteLength(JSON.stringify(value), 'utf8') / 4);
}

function materializeSnapshot(snapshot: Awaited<ReturnType<typeof buildCompanySnapshot>>, inputBudget: number) {
  const critical = {
    snapshotId: snapshot.snapshotId,
    generatedAt: snapshot.generatedAt,
    businessDate: snapshot.businessDate,
    source: snapshot.source,
    metrics: snapshot.metrics,
    quality: snapshot.quality,
    freshness: snapshot.freshness,
    distributions: snapshot.distributions,
  };
  const full = { ...critical, calibration: snapshot.calibration };
  if (estimateTokens(full) <= inputBudget) return { payload: full, selected: false, blocked: false };

  const selected = {
    ...critical,
    calibration: {
      actionableProducts: snapshot.calibration.actionableProducts.slice(0, 25),
      delayedShipmentDossiers: snapshot.calibration.delayedShipmentDossiers.slice(0, 25),
      selectionNotice: 'Evidence was deterministically selected to fit the input budget; critical metrics, gaps and freshness were retained.',
    },
  };
  return { payload: selected, selected: true, blocked: estimateTokens(selected) > inputBudget };
}

async function appendCaseEvent(tx: Tx, input: {
  caseId: string;
  requestId: string;
  eventType: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  payload?: Record<string, unknown>;
  idempotencyKey: string;
}) {
  const existing = await tx.companyOsCaseEvent.findUnique({
    where: { caseId_idempotencyKey: { caseId: input.caseId, idempotencyKey: input.idempotencyKey } },
  });
  if (existing) return existing;
  const previous = await tx.companyOsCaseEvent.findFirst({ where: { caseId: input.caseId }, orderBy: { sequence: 'desc' } });
  const sequence = (previous?.sequence ?? 0) + 1;
  const payload = input.payload ?? {};
  const eventHash = hash(JSON.stringify({
    requestId: input.requestId,
    sequence,
    eventType: input.eventType,
    fromStatus: input.fromStatus ?? null,
    toStatus: input.toStatus ?? null,
    payload,
    previousHash: previous?.eventHash ?? null,
  }));
  return tx.companyOsCaseEvent.create({ data: {
    caseId: input.caseId,
    sequence,
    eventType: input.eventType,
    fromStatus: input.fromStatus ?? null,
    toStatus: input.toStatus ?? null,
    payload: jsonValue(payload),
    idempotencyKey: input.idempotencyKey,
    previousHash: previous?.eventHash ?? null,
    eventHash,
  } });
}

export async function createCompanyOsCase(rawObjective: string, identity: Identity, relatedRequestId?: string) {
  if (rawObjective.trim().length > 600) throw new Error('La orden supera 600 caracteres y no será truncada silenciosamente');
  const sanitized = sanitizeCompanyObjective(rawObjective);
  const budgets = companyOsV3BudgetConfig();
  if (!sanitized.safeObjective) throw new Error('La orden no puede quedar vacía');
  const snapshot = await buildCompanySnapshot();
  const evidence = materializeSnapshot(snapshot, budgets.inputBudget);
  const inputBudgetEstimate = estimateTokens({ objective: sanitized.safeObjective, evidence: evidence.payload }) + 300;
  const blocked = evidence.blocked || inputBudgetEstimate > budgets.inputBudget;
  const requestId = randomUUID();
  const db = companyOsV3Prisma();

  const created = await db.$transaction(async (tx) => {
    const relatedCase = relatedRequestId
      ? await tx.companyOsCase.findUnique({ where: { requestId: relatedRequestId }, select: { id: true } })
      : null;
    if (relatedRequestId && !relatedCase) throw new Error('El caso relacionado no existe');
    const companyCase = await tx.companyOsCase.create({ data: {
      requestId,
      objective: sanitized.safeObjective,
      objectiveHash: sanitized.objectiveHash,
      status: blocked ? 'BLOCKED' : 'QUEUED',
      actorRef: identity.actorRef,
      authMode: identity.authMode,
      relatedCaseId: relatedCase?.id,
      inputBudgetEstimate,
      maxOutputTokens: budgets.maxOutputTokens,
      targetTotalTokens: budgets.targetTotalTokens,
      webhookDeliveryStatus: blocked ? 'FAILED' : 'PENDING',
    } });
    await tx.companyOsMessage.create({ data: {
      caseId: companyCase.id, role: 'USER', kind: 'ORDER', content: sanitized.safeObjective, actorRef: identity.actorRef,
    } });
    const refs = Object.entries(evidence.payload).map(([evidenceKey, value]) => ({
      caseId: companyCase.id,
      evidenceKey,
      sourceRef: `company-os-snapshot:${snapshot.snapshotId}#${evidenceKey}`,
      value: jsonValue(value),
      critical: ['metrics', 'quality', 'freshness'].includes(evidenceKey),
      observedAt: new Date(snapshot.generatedAt),
    }));
    await tx.companyOsEvidenceRef.createMany({ data: refs });
    await appendCaseEvent(tx, {
      caseId: companyCase.id, requestId, eventType: blocked ? 'CASE_BLOCKED_INPUT_BUDGET' : 'CASE_QUEUED', toStatus: blocked ? 'BLOCKED' : 'QUEUED',
      payload: { snapshotId: snapshot.snapshotId, inputBudgetEstimate, inputBudget: budgets.inputBudget, evidenceSelected: evidence.selected, redactions: sanitized.redactions },
      idempotencyKey: `case:${requestId}:${blocked ? 'blocked' : 'queued'}`,
    });
    await tx.companyOsAuditEvent.create({ data: {
      requestId, action: 'CASE_CREATED', actorRef: identity.actorRef,
      metadata: jsonValue({ businessWrites: 0, identity: 'general-manager-ai-v3' }),
      idempotencyKey: `audit:${requestId}:created`,
    } });
    return companyCase;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  return { ...created, redactions: sanitized.redactions };
}

export async function dispatchCompanyOsWebhook(companyCase: Pick<CompanyOsCase, 'id' | 'requestId'>) {
  const db = companyOsV3Prisma();
  const baseUrl = (process.env.COMPANY_OS_V3_WORKER_URL ?? '').trim().replace(/\/$/, '');
  const body = JSON.stringify({ requestId: companyCase.requestId });
  let status: 'DELIVERED' | 'FAILED' = 'FAILED';
  let responseCode: number | null = null;
  let errorDetail: string | null = null;
  try {
    if (!baseUrl) throw new Error('COMPANY_OS_V3_WORKER_URL no configurada');
    const signed = signCompanyOsWorkerPayload(body);
    const response = await fetch(`${baseUrl}/webhook`, {
      method: 'POST', body, signal: AbortSignal.timeout(10_000),
      headers: {
        'content-type': 'application/json',
        'x-company-os-timestamp': signed.timestamp,
        'x-company-os-signature': signed.signature,
      },
    });
    responseCode = response.status;
    if (!response.ok) throw new Error(`Webhook HTTP ${response.status}`);
    status = 'DELIVERED';
  } catch (error) {
    errorDetail = (error instanceof Error ? error.message : 'unknown').slice(0, 500);
  }
  await db.$transaction(async (tx) => {
    await tx.companyOsNotificationDelivery.create({ data: {
      caseId: companyCase.id, requestId: companyCase.requestId, channel: 'WEBHOOK', eventType: 'CASE_QUEUED',
      status, attempt: 1, responseCode, errorDetail, idempotencyKey: `webhook:${companyCase.requestId}:1`,
    } });
    await tx.companyOsCase.update({ where: { id: companyCase.id }, data: { webhookDeliveryStatus: status } });
    await appendCaseEvent(tx, {
      caseId: companyCase.id, requestId: companyCase.requestId,
      eventType: status === 'DELIVERED' ? 'WEBHOOK_DELIVERED' : 'WEBHOOK_DELIVERY_FAILED',
      payload: { responseCode, errorDetail, recoverable: true }, idempotencyKey: `case:${companyCase.requestId}:webhook:1`,
    });
  });
  return { status, responseCode, errorDetail };
}

type ClaimedRow = { id: string; requestId: string; objective: string; status: string; webhookDeliveryStatus: string; maxOutputTokens: number; targetTotalTokens: number };

export async function claimCompanyOsCase(requestId?: string) {
  const db = companyOsV3Prisma();
  return db.$transaction(async (tx) => {
    const requested = requestId?.trim() || null;
    const globalLock = await tx.companyOsLock.findUnique({ where: { requestId: GLOBAL_LOCK_ID } });
    if (globalLock && globalLock.expiresAt > new Date()) return null;
    const rows = await tx.$queryRaw<ClaimedRow[]>(Prisma.sql`
      SELECT c.id, c."requestId", c.objective, c.status, c."webhookDeliveryStatus", c."maxOutputTokens", c."targetTotalTokens"
      FROM public."CompanyOsCase" c
      WHERE (${requested}::text IS NULL OR c."requestId" = ${requested})
        AND (
          c.status = 'QUEUED'
          OR (c.status = 'ANALYZING' AND NOT EXISTS (
            SELECT 1 FROM public."CompanyOsLease" l
            WHERE l."caseId" = c.id AND l.status = 'ACTIVE' AND l."expiresAt" > now()
          ))
          OR (c.status = 'FAILED' AND (
            SELECT count(*) FROM public."CompanyOsExecutionAttempt" a
            WHERE a."caseId" = c.id
          ) < 2)
        )
      ORDER BY c."createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);
    const companyCase = rows[0];
    if (!companyCase) return null;

    const evidence = await tx.companyOsEvidenceRef.findMany({ where: { caseId: companyCase.id }, orderBy: { evidenceKey: 'asc' } });
    const contextMessages = await tx.companyOsMessage.findMany({ where: { caseId: companyCase.id, kind: 'CONTEXT' }, orderBy: { createdAt: 'asc' }, select: { content: true, createdAt: true } });
    const evidencePayload = Object.fromEntries(evidence.map((entry) => [entry.evidenceKey, entry.value]));
    const inputEstimate = estimateTokens({ objective: companyCase.objective, evidencePayload, contextMessages }) + 300;
    const inputBudget = companyCase.targetTotalTokens - companyCase.maxOutputTokens;
    if (inputEstimate > inputBudget) {
      await tx.companyOsCase.update({ where: { id: companyCase.id }, data: { status: 'BLOCKED' } });
      await appendCaseEvent(tx, { caseId: companyCase.id, requestId: companyCase.requestId, eventType: 'CASE_BLOCKED_INPUT_BUDGET', fromStatus: companyCase.status, toStatus: 'BLOCKED', payload: { inputEstimate, inputBudget }, idempotencyKey: `case:${companyCase.requestId}:blocked:context-budget` });
      return null;
    }

    const now = new Date();
    const leaseToken = randomUUID();
    const expiresAt = new Date(now.getTime() + LEASE_MS);
    await tx.companyOsLease.updateMany({
      where: { caseId: companyCase.id, status: 'ACTIVE', expiresAt: { lte: now } },
      data: { status: 'EXPIRED', releasedAt: now },
    });
    await tx.companyOsLock.upsert({
      where: { requestId: companyCase.requestId },
      create: { requestId: companyCase.requestId, ownerToken: leaseToken, expiresAt },
      update: { ownerToken: leaseToken, expiresAt },
    });
    await tx.companyOsLock.upsert({ where: { requestId: GLOBAL_LOCK_ID }, create: { requestId: GLOBAL_LOCK_ID, ownerToken: `${leaseToken}:global`, expiresAt }, update: { ownerToken: `${leaseToken}:global`, expiresAt } });
    const priorAttempts = await tx.companyOsExecutionAttempt.count({ where: { requestId: companyCase.requestId } });
    const attempt = priorAttempts + 1;
    await tx.companyOsLease.create({ data: {
      caseId: companyCase.id, requestId: companyCase.requestId, leaseToken, ownerRef: WORKER_REF, expiresAt,
    } });
    await tx.companyOsExecutionAttempt.create({ data: {
      caseId: companyCase.id, requestId: companyCase.requestId, leaseToken, attempt, outcome: 'STARTED',
    } });
    await tx.companyOsHeartbeat.create({ data: {
      caseId: companyCase.id, requestId: companyCase.requestId, leaseToken, workerRef: WORKER_REF, phase: 'CLAIMED',
    } });
    await tx.companyOsCase.update({ where: { id: companyCase.id }, data: {
      status: 'ANALYZING',
      webhookDeliveryStatus: companyCase.webhookDeliveryStatus === 'FAILED' ? 'RECOVERED' : undefined,
    } });
    await appendCaseEvent(tx, {
      caseId: companyCase.id, requestId: companyCase.requestId, eventType: 'CASE_CLAIMED',
      fromStatus: companyCase.status, toStatus: 'ANALYZING', payload: { attempt, recovered: attempt > 1 },
      idempotencyKey: `case:${companyCase.requestId}:claim:${attempt}`,
    });
    return {
      caseId: companyCase.id, requestId: companyCase.requestId, objective: companyCase.objective,
      leaseToken, leaseExpiresAt: expiresAt.toISOString(), attempt,
      evidencePayload, contextMessages,
      budgets: { input: inputBudget, maxOutputTokens: companyCase.maxOutputTokens, targetTotal: companyCase.targetTotalTokens },
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function activeLease(tx: Tx, requestId: string, leaseToken: string) {
  const lease = await tx.companyOsLease.findFirst({ where: { requestId, leaseToken, status: 'ACTIVE', expiresAt: { gt: new Date() } } });
  if (!lease) throw new Error('Lease inválido o ya liberado');
  const [requestLock, globalLock] = await Promise.all([
    tx.companyOsLock.findUnique({ where: { requestId } }), tx.companyOsLock.findUnique({ where: { requestId: GLOBAL_LOCK_ID } }),
  ]);
  if (requestLock?.ownerToken !== leaseToken || globalLock?.ownerToken !== `${leaseToken}:global`) throw new Error('El worker perdió la titularidad del lock');
  return lease;
}

export async function heartbeatCompanyOsCase(requestId: string, leaseToken: string, phase: string) {
  const db = companyOsV3Prisma();
  return db.$transaction(async (tx) => {
    const lease = await activeLease(tx, requestId, leaseToken);
    const expiresAt = new Date(Date.now() + LEASE_MS);
    await tx.companyOsLease.update({ where: { id: lease.id }, data: { expiresAt } });
    await tx.companyOsLock.update({ where: { requestId }, data: { expiresAt } });
    await tx.companyOsLock.update({ where: { requestId: GLOBAL_LOCK_ID }, data: { expiresAt } });
    return tx.companyOsHeartbeat.create({ data: {
      caseId: lease.caseId, requestId, leaseToken, workerRef: WORKER_REF, phase: phase.slice(0, 80),
    } });
  });
}

function validateWorkerResult(result: CompanyOsWorkerResult, knownRefs: Set<string>) {
  if (!result || typeof result.summary !== 'string' || typeof result.primaryDataQualityProblem !== 'string'
    || typeof result.recommendedNextStep !== 'string' || !Array.isArray(result.evidenceRefs) || !Array.isArray(result.missions)) {
    throw new Error('Resultado del worker inválido');
  }
  if (result.evidenceRefs.some((ref) => !knownRefs.has(ref))) throw new Error('El resultado contiene referencias de evidencia inventadas');
  if (result.missions.some((mission) => mission.status !== 'PLANNED' || mission.evidenceRefs.some((ref) => !knownRefs.has(ref)))) {
    throw new Error('V3 sólo acepta misiones PLANNED con evidencia materializada');
  }
}

export function estimateCompanyOsCost(usage: CompanyOsWorkerUsage) {
  const nonCachedInput = Math.max(0, usage.inputTokens - usage.cachedTokens - usage.cacheWriteTokens);
  return (nonCachedInput * 5 + usage.cachedTokens * 0.5 + usage.cacheWriteTokens * 6.25 + usage.outputTokens * 30) / 1_000_000;
}

export async function completeCompanyOsCase(input: {
  requestId: string; leaseToken: string; result: CompanyOsWorkerResult; usage: CompanyOsWorkerUsage;
}) {
  const db = companyOsV3Prisma();
  return db.$transaction(async (tx) => {
    const existing = await tx.companyOsCase.findUnique({ where: { requestId: input.requestId } });
    if (!existing) throw new Error('Caso inexistente');
    if (existing.status === 'AWAITING_REVIEW' || existing.status === 'COMPLETED') return { reused: true, status: existing.status };
    if (existing.status === 'CANCELLED') throw new Error('El caso fue cancelado y no acepta resultados');
    const lease = await activeLease(tx, input.requestId, input.leaseToken);
    const refs = await tx.companyOsEvidenceRef.findMany({ where: { caseId: existing.id }, select: { evidenceKey: true } });
    validateWorkerResult(input.result, new Set(refs.map((ref) => ref.evidenceKey)));
    if (input.usage.totalTokens > existing.targetTotalTokens) throw new Error('Consumo total excede el presupuesto autorizado');

    await tx.companyOsMessage.create({ data: {
      caseId: existing.id, role: 'ASSISTANT', kind: 'RESULT', actorRef: WORKER_REF,
      content: JSON.stringify(input.result),
    } });
    if (input.result.missions.length) {
      await tx.companyOsMission.createMany({ data: input.result.missions.map((mission) => ({
        caseId: existing.id, title: mission.title,
        rationale: `Evidencia: ${mission.evidenceRefs.join(', ')}`,
        expectedOutput: mission.objective, status: 'PLANNED',
      })) });
    }
    const start = new Date(); start.setUTCHours(0, 0, 0, 0);
    const daily = await tx.companyOsUsage.aggregate({
      where: { createdAt: { gte: start } }, _sum: { totalTokens: true, estimatedCostUsd: true },
    });
    const estimatedCostUsd = estimateCompanyOsCost(input.usage);
    const dailyTotalTokens = (daily._sum.totalTokens ?? 0) + input.usage.totalTokens;
    const dailyCostUsd = Number(daily._sum.estimatedCostUsd ?? 0) + estimatedCostUsd;
    const pct = Math.round(input.usage.totalTokens / existing.targetTotalTokens * 100);
    const configuredAlerts = companyOsV3BudgetConfig().alerts;
    const alertLevel = configuredAlerts.filter((level) => pct >= level).sort((a, b) => b - a)[0] ?? null;
    await tx.companyOsUsage.create({ data: {
      caseId: existing.id, provider: input.usage.provider, model: input.usage.model,
      inputTokens: input.usage.inputTokens, cachedTokens: input.usage.cachedTokens,
      cacheWriteTokens: input.usage.cacheWriteTokens, outputTokens: input.usage.outputTokens,
      reasoningTokens: input.usage.reasoningTokens, totalTokens: input.usage.totalTokens,
      estimatedCostUsd, dailyTotalTokens, dailyCostUsd, alertLevel,
    } });
    const toStatus: CompanyOsRequestStatus = input.result.missions.length ? 'AWAITING_REVIEW' : 'COMPLETED';
    await tx.companyOsCase.update({ where: { id: existing.id }, data: {
      status: toStatus, completedAt: toStatus === 'COMPLETED' ? new Date() : null,
    } });
    await tx.companyOsLease.update({ where: { id: lease.id }, data: { status: 'COMPLETED', releasedAt: new Date() } });
    await tx.companyOsLock.deleteMany({ where: { ownerToken: { in: [input.leaseToken, `${input.leaseToken}:global`] } } });
    await tx.companyOsExecutionAttempt.update({
      where: { requestId_attempt: { requestId: input.requestId, attempt: await tx.companyOsExecutionAttempt.count({ where: { requestId: input.requestId } }) } },
      data: { outcome: 'SUCCEEDED', finishedAt: new Date() },
    });
    await appendCaseEvent(tx, {
      caseId: existing.id, requestId: input.requestId, eventType: 'ANALYSIS_COMPLETED',
      fromStatus: 'ANALYZING', toStatus, payload: { evidenceRefs: input.result.evidenceRefs, totalTokens: input.usage.totalTokens, alertLevel },
      idempotencyKey: `case:${input.requestId}:completed`,
    });
    await tx.companyOsAuditEvent.create({ data: {
      requestId: input.requestId, action: 'ANALYSIS_COMPLETED', actorRef: WORKER_REF,
      metadata: jsonValue({ businessWrites: 0, requestStatus: toStatus, missionsCreated: input.result.missions.length }),
      idempotencyKey: `audit:${input.requestId}:completed`,
    } });
    return { reused: false, status: toStatus, estimatedCostUsd, dailyTotalTokens, alertLevel };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function failCompanyOsCase(requestId: string, leaseToken: string, errorCode: string, detail: string) {
  const db = companyOsV3Prisma();
  return db.$transaction(async (tx) => {
    const lease = await activeLease(tx, requestId, leaseToken);
    const companyCase = await tx.companyOsCase.findUniqueOrThrow({ where: { requestId } });
    const attempt = await tx.companyOsExecutionAttempt.findFirstOrThrow({ where: { requestId, leaseToken } });
    await tx.companyOsExecutionAttempt.update({ where: { id: attempt.id }, data: {
      outcome: errorCode === 'MODEL_TIMEOUT' ? 'TIMED_OUT' : 'FAILED', errorCode: errorCode.slice(0, 80), detail: detail.slice(0, 500), finishedAt: new Date(),
    } });
    await tx.companyOsLease.update({ where: { id: lease.id }, data: { status: 'FAILED', releasedAt: new Date() } });
    await tx.companyOsLock.deleteMany({ where: { ownerToken: { in: [leaseToken, `${leaseToken}:global`] } } });
    await tx.companyOsCase.update({ where: { id: companyCase.id }, data: { status: 'FAILED' } });
    await appendCaseEvent(tx, {
      caseId: companyCase.id, requestId, eventType: 'ANALYSIS_FAILED', fromStatus: 'ANALYZING', toStatus: 'FAILED',
      payload: { errorCode, detail: detail.slice(0, 200) }, idempotencyKey: `case:${requestId}:failed:${attempt.attempt}`,
    });
    return { status: 'FAILED' as const };
  });
}

export async function recordCompanyOsNotification(input: {
  requestId: string; leaseToken: string; status: 'DELIVERED' | 'FAILED'; responseCode?: number | null; errorDetail?: string | null;
}) {
  const db = companyOsV3Prisma();
  return db.$transaction(async (tx) => {
    const companyCase = await tx.companyOsCase.findUniqueOrThrow({ where: { requestId: input.requestId } });
    const lease = await tx.companyOsLease.findFirst({ where: { requestId: input.requestId, leaseToken: input.leaseToken } });
    if (!lease || lease.caseId !== companyCase.id) throw new Error('Lease de notificación inválido');
    const idempotencyKey = `telegram:${input.requestId}:completed`;
    const existing = await tx.companyOsNotificationDelivery.findUnique({ where: { idempotencyKey } });
    if (existing) return { reused: true, delivery: existing };
    const delivery = await tx.companyOsNotificationDelivery.create({ data: {
      caseId: companyCase.id, requestId: input.requestId, channel: 'TELEGRAM', eventType: 'ANALYSIS_COMPLETED',
      status: input.status, attempt: 1, responseCode: input.responseCode ?? null,
      errorDetail: input.errorDetail?.slice(0, 500) ?? null, idempotencyKey,
    } });
    await appendCaseEvent(tx, {
      caseId: companyCase.id, requestId: input.requestId,
      eventType: input.status === 'DELIVERED' ? 'TELEGRAM_DELIVERED' : 'TELEGRAM_DELIVERY_FAILED',
      payload: { responseCode: input.responseCode ?? null, errorDetail: input.errorDetail?.slice(0, 200) ?? null },
      idempotencyKey: `case:${input.requestId}:telegram:completed`,
    });
    return { reused: false, delivery };
  });
}

export async function getCompanyOsCase(requestId: string) {
  return companyOsV3Prisma().companyOsCase.findUnique({ where: { requestId }, include: {
    messages: { orderBy: { createdAt: 'asc' } }, events: { orderBy: { sequence: 'asc' } },
    evidence: { orderBy: { evidenceKey: 'asc' } }, missions: { orderBy: { createdAt: 'asc' } },
    decisions: { orderBy: { createdAt: 'asc' } }, usage: { orderBy: { createdAt: 'asc' } },
    heartbeats: { orderBy: { createdAt: 'asc' } }, attempts: { orderBy: { attempt: 'asc' } },
    deliveries: { orderBy: { createdAt: 'asc' } }, leases: { orderBy: { createdAt: 'asc' } },
  } });
}

export async function listCompanyOsCases(limit = 30) {
  return companyOsV3Prisma().companyOsCase.findMany({
    take: Math.min(Math.max(limit, 1), 100), orderBy: { createdAt: 'desc' },
    include: { messages: { orderBy: { createdAt: 'asc' } }, usage: true, missions: true, heartbeats: { take: 1, orderBy: { createdAt: 'desc' } } },
  });
}

export async function appendCompanyOsContext(requestId: string, content: string, identity: Identity) {
  const trimmed = content.trim();
  if (!trimmed || trimmed.length > 4000) throw new Error('El contexto debe tener entre 1 y 4000 caracteres');
  const db = companyOsV3Prisma();
  return db.$transaction(async (tx) => {
    const companyCase = await tx.companyOsCase.findUniqueOrThrow({ where: { requestId } });
    if (TERMINAL_REQUEST_STATUSES.has(companyCase.status as CompanyOsRequestStatus)) throw new Error('El caso ya no admite contexto adicional');
    const message = await tx.companyOsMessage.create({ data: {
      caseId: companyCase.id, role: 'USER', kind: 'CONTEXT', content: trimmed, actorRef: identity.actorRef,
    } });
    await appendCaseEvent(tx, {
      caseId: companyCase.id, requestId, eventType: 'CONTEXT_APPENDED', payload: { messageId: message.id },
      idempotencyKey: `case:${requestId}:context:${message.id}`,
    });
    return message;
  });
}

export async function cancelCompanyOsCase(requestId: string, reason: string, identity: Identity) {
  const db = companyOsV3Prisma();
  return db.$transaction(async (tx) => {
    const companyCase = await tx.companyOsCase.findUniqueOrThrow({ where: { requestId } });
    const fromStatus = companyCase.status as CompanyOsRequestStatus;
    if (TERMINAL_REQUEST_STATUSES.has(fromStatus)) return { reused: true, status: fromStatus };
    await tx.companyOsCase.update({ where: { id: companyCase.id }, data: { status: 'CANCELLED', cancellationReason: reason.slice(0, 500) } });
    await tx.companyOsLease.updateMany({ where: { caseId: companyCase.id, status: 'ACTIVE' }, data: { status: 'RELEASED', releasedAt: new Date() } });
    const requestLock = await tx.companyOsLock.findUnique({ where: { requestId }, select: { ownerToken: true } });
    if (requestLock) await tx.companyOsLock.deleteMany({ where: { ownerToken: { in: [requestLock.ownerToken, `${requestLock.ownerToken}:global`] } } });
    await appendCaseEvent(tx, {
      caseId: companyCase.id, requestId, eventType: 'CASE_CANCELLED', fromStatus, toStatus: 'CANCELLED',
      payload: { reason: reason.slice(0, 500), actorRef: identity.actorRef }, idempotencyKey: `case:${requestId}:cancelled`,
    });
    return { reused: false, status: 'CANCELLED' as const };
  });
}

export async function decideCompanyOsMission(input: {
  requestId: string; missionId: string; decision: 'APPROVE' | 'REJECT' | 'REQUEST_REVIEW' | 'BLOCK'; reason?: string; idempotencyKey: string;
}, identity: Identity) {
  const transitions: Record<typeof input.decision, CompanyOsMissionStatus> = {
    APPROVE: 'APPROVED', REJECT: 'REJECTED', REQUEST_REVIEW: 'REVIEW', BLOCK: 'BLOCKED',
  };
  const target = transitions[input.decision];
  if (!COMPANY_OS_MISSION_STATUSES.includes(target) || target === 'RUNNING' || target === 'DONE') throw new Error('V3 no autoriza ejecución de misiones');
  const db = companyOsV3Prisma();
  return db.$transaction(async (tx) => {
    const companyCase = await tx.companyOsCase.findUniqueOrThrow({ where: { requestId: input.requestId } });
    const mission = await tx.companyOsMission.findFirstOrThrow({ where: { id: input.missionId, caseId: companyCase.id } });
    const existing = await tx.companyOsDecision.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return { reused: true, mission };
    await tx.companyOsDecision.create({ data: {
      caseId: companyCase.id, missionId: mission.id, decision: input.decision, reason: input.reason,
      actorRef: identity.actorRef, idempotencyKey: input.idempotencyKey,
    } });
    const updated = await tx.companyOsMission.update({ where: { id: mission.id }, data: { status: target } });
    await appendCaseEvent(tx, {
      caseId: companyCase.id, requestId: input.requestId, eventType: 'MISSION_DECIDED',
      payload: { missionId: mission.id, fromMissionStatus: mission.status, toMissionStatus: target, executionAuthorized: false },
      idempotencyKey: `case:${input.requestId}:mission:${input.idempotencyKey}`,
    });
    return { reused: false, mission: updated, executionAuthorized: false };
  });
}

export function assertRequestStatus(value: string): asserts value is CompanyOsRequestStatus {
  if (!COMPANY_OS_REQUEST_STATUSES.includes(value as CompanyOsRequestStatus)) throw new Error('Estado de solicitud inválido');
}
