import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { sanitizeCompanyText } from './objective';
import {
  COMPANY_OS_INSTALLED_AGENT_IDS,
  COMPANY_OS_TEAM_MANIFEST,
  getCompanyOsRuntimeContract,
  validateCompanyOsRuntimeOutput,
} from './runtime-contracts';
import { companyOsV3Prisma } from './v3-prisma';
import { resolveCompanyOsRuntimeDataPolicy } from './runtime-data-policy';
import { runtimeResultNeedsReview } from './runtime-outcome';
import { findCompletedRuntimeDelegation, runtimeFollowUpCapacity } from './runtime-delegation';
import { deriveRuntimeAgentState, type RuntimeAgentStateWork } from './runtime-agent-status';
import { planAdaptiveRuntimeBudget, planRuntimeBudget, startOfZonedPeriod } from './runtime-budget';
import { withRuntimeObjectiveClaimFence } from './runtime-objective-guard';
import {
  COMPANY_OS_DATA_MANAGER_IDENTITY,
  COMPANY_OS_SYSTEMS_MANAGER_IDENTITY,
  COMPANY_OS_V3_IDENTITY,
  companyOsV3BudgetConfig,
  type CompanyOsWorkerUsage,
} from './v3-types';

type Tx = Prisma.TransactionClient;

const INSTALLED_AGENT_IDS = COMPANY_OS_INSTALLED_AGENT_IDS;
const GENERAL_MANAGER_ID = COMPANY_OS_V3_IDENTITY;
const SYSTEMS_MANAGER_ID = COMPANY_OS_SYSTEMS_MANAGER_IDENTITY;
const ACTIVE_WORK_STATUSES = ['CLAIMED', 'RUNNING'] as const;
const TERMINAL_CASE_STATUSES = new Set(['COMPLETED', 'CANCELLED']);
const WORKER_STALE_MS = 150_000;
const DEPENDENCY_STALE_MS = 150_000;
const DEFAULT_LEASE_MS = 300_000;
const DAILY_AGENT_TOKEN_LIMIT = 48_000;
const MONTHLY_AGENT_TOKEN_LIMIT = 1_000_000;
const REQUESTS_PER_MINUTE = 240;

// An explicit rollout scope prevents a budget fix from activating other goals.
function adaptiveLocalGoalIds() {
  const ids = (process.env.COMPANY_OS_ADAPTIVE_LOCAL_GOAL_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean);
  if (ids.length > 16 || ids.some((id) => !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))) {
    throw new Error('Invalid adaptive local goal allowlist');
  }
  return [...new Set(ids)];
}

async function adaptiveLocalCaseEnabled(tx: Tx, caseId: string) {
  const goalIds = adaptiveLocalGoalIds();
  if (goalIds.length === 0) return false;
  const matches = await tx.$queryRaw<Array<{ enabled: boolean }>>(Prisma.sql`
    SELECT true AS enabled FROM public."CompanyOsObjectiveUnit" unit
    WHERE unit."caseId" = ${caseId} AND unit."goalId" IN (${Prisma.join(goalIds)}) LIMIT 1
  `);
  return matches[0]?.enabled === true;
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

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

function cleanText(value: unknown, max = 4_000) {
  return sanitizeCompanyText(typeof value === 'string' ? value : JSON.stringify(value), max).safeText;
}

function estimateJsonTokens(value: unknown) {
  return Math.ceil(Buffer.byteLength(JSON.stringify(value), 'utf8') / 4);
}

function sanitizeRuntimeValue(value: unknown): unknown {
  if (typeof value === 'string') return cleanText(value, 4_000);
  if (Array.isArray(value)) return value.slice(0, 100).map(sanitizeRuntimeValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
      key,
      /(authorization|cookie|password|secret|token|api.?key|private.?key|credential)/i.test(key)
        ? '[SECRET_REDACTED]'
        : sanitizeRuntimeValue(nested),
    ]));
  }
  return value;
}

function positiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Objeto de runtime inválido');
  return value as Record<string, unknown>;
}

async function appendRuntimeEvent(tx: Tx, input: {
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

export function isCompanyOsRuntimeAgentInstalled(agentId: string): agentId is typeof INSTALLED_AGENT_IDS[number] {
  return INSTALLED_AGENT_IDS.includes(agentId as typeof INSTALLED_AGENT_IDS[number]);
}

export async function enqueueInitialRuntimeWorkItem(tx: Tx, input: {
  caseId: string;
  requestId: string;
  agentId: string;
  objective: string;
  causalMessageId?: string;
  triggerType: 'MANUAL' | 'SCHEDULE' | 'EVENT' | 'AGENT_MESSAGE' | 'RECOVERY' | 'INCIDENT';
  priority?: number;
  timeoutMs?: number;
  reservedTokens?: number;
}) {
  if (!isCompanyOsRuntimeAgentInstalled(input.agentId)) throw new Error(`Agente ${input.agentId} NOT_INSTALLED`);
  return tx.companyOsWorkItem.create({ data: {
    id: randomUUID(),
    caseId: input.caseId,
    agentId: input.agentId,
    triggerType: input.triggerType,
    priority: Math.min(100, Math.max(0, input.priority ?? 50)),
    causalMessageId: input.causalMessageId,
    inputPayload: jsonValue({ objective: input.objective, requestId: input.requestId }),
    idempotencyKey: `work:${input.requestId}:initial:${input.agentId}`,
    timeoutMs: positiveInteger(input.timeoutMs, 120_000),
    reservedTokens: positiveInteger(input.reservedTokens, 12_000),
  } });
}

export class CompanyOsRuntimeRequestError extends Error {
  constructor(message: string, readonly status: 400 | 409 | 429) {
    super(message);
  }
}

export async function acceptCompanyOsRuntimeNonce(workerId: string, nonce: string, endpoint: string) {
  const db = companyOsV3Prisma();
  return db.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`
      SELECT 1 AS locked
      FROM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(${`company-os-worker-rate:${workerId}`}, 0)
      )
    `);
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT now() AS now`);
    if (!clock?.now) throw new Error('DATABASE_CLOCK_UNOBSERVED');
    const now = clock.now;
    const minuteAgo = new Date(now.getTime() - 60_000);
    await tx.companyOsWorkerRequestNonce.deleteMany({ where: { workerId, expiresAt: { lte: now } } });
    const recent = await tx.companyOsWorkerRequestNonce.count({ where: { workerId, createdAt: { gte: minuteAgo } } });
    if (recent >= REQUESTS_PER_MINUTE) throw new CompanyOsRuntimeRequestError('Límite de solicitudes del worker excedido', 429);
    try {
      await tx.companyOsWorkerRequestNonce.create({ data: {
        nonce,
        workerId,
        endpoint: endpoint.slice(0, 200),
        expiresAt: new Date(now.getTime() + 10 * 60_000),
      } });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new CompanyOsRuntimeRequestError('Nonce ya utilizado', 409);
      throw error;
    }
    return { accepted: true } as const;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

type ExpiredLeaseRow = {
  id: string;
  caseId: string;
  requestId: string;
  leaseToken: string;
  workItemId: string | null;
  slotNo: number | null;
};

async function expireLeases(tx: Tx, now: Date) {
  const expired = await tx.$queryRaw<ExpiredLeaseRow[]>(Prisma.sql`
    SELECT id, "caseId", "requestId", "leaseToken", "workItemId", "slotNo"
    FROM public."CompanyOsLease"
    WHERE status = 'ACTIVE' AND "expiresAt" <= ${now}
    FOR UPDATE SKIP LOCKED
  `);
  for (const lease of expired) {
    const workItem = lease.workItemId ? await tx.companyOsWorkItem.findUnique({ where: { id: lease.workItemId } }) : null;
    const attempt = await tx.companyOsExecutionAttempt.findFirst({ where: { leaseToken: lease.leaseToken, finishedAt: null } });
    const retryable = Boolean(workItem && workItem.attemptCount < workItem.maxAttempts);
    if (attempt) await tx.companyOsExecutionAttempt.update({ where: { id: attempt.id }, data: {
      outcome: 'TIMED_OUT', errorCode: 'LEASE_EXPIRED', detail: 'Lease expired before completion', finishedAt: now,
    } });
    await tx.companyOsLease.update({ where: { id: lease.id }, data: { status: 'EXPIRED', releasedAt: now } });
    if (lease.slotNo) await tx.companyOsRuntimeSlot.updateMany({
      where: { slotNo: lease.slotNo, leaseToken: lease.leaseToken },
      data: { leaseToken: null, agentId: null, workerId: null, expiresAt: null },
    });
    if (workItem && ACTIVE_WORK_STATUSES.includes(workItem.status as typeof ACTIVE_WORK_STATUSES[number])) {
      await tx.companyOsWorkItem.update({ where: { id: workItem.id }, data: {
        status: retryable ? 'FAILED_RETRYABLE' : 'FAILED_FINAL',
        nextAttemptAt: retryable ? new Date(now.getTime() + 30_000) : null,
      } });
      const otherActive = await tx.companyOsWorkItem.count({ where: {
        caseId: lease.caseId,
        id: { not: workItem.id },
        status: { in: [...ACTIVE_WORK_STATUSES] },
      } });
      const companyCase = await tx.companyOsCase.findUnique({ where: { id: lease.caseId } });
      const toStatus = otherActive > 0 ? companyCase?.status : retryable ? 'FAILED_RETRYABLE' : 'FAILED_FINAL';
      if (companyCase && toStatus && companyCase.status !== toStatus && !TERMINAL_CASE_STATUSES.has(companyCase.status)) {
        await tx.companyOsCase.update({ where: { id: companyCase.id }, data: { status: toStatus, nextAttemptAt: retryable ? new Date(now.getTime() + 30_000) : null } });
      }
      await appendRuntimeEvent(tx, {
        caseId: lease.caseId,
        requestId: lease.requestId,
        eventType: 'LEASE_EXPIRED',
        fromStatus: companyCase?.status,
        toStatus,
        payload: { workItemId: workItem.id, attempt: workItem.attemptCount, retryable },
        idempotencyKey: `runtime:${lease.requestId}:lease-expired:${lease.leaseToken}`,
      });
    }
  }
  return expired.length;
}

type ClaimCandidate = {
  workItemId: string;
  caseId: string;
  requestId: string;
  agentId: string;
  objective: string;
  workObjective: string | null;
  caseStatus: string;
  caseType: string;
  maxOutputTokens: number;
  targetTotalTokens: number;
  turnCount: number;
  maxTurns: number;
  workStatus: string;
  attemptCount: number;
  maxAttempts: number;
  timeoutMs: number;
  reservedTokens: number;
  contractVersion: string;
  handlerKey: string;
  contract: Prisma.JsonValue;
  causalMessageType: string | null;
  causalKind: string | null;
  causalFromAgentId: string | null;
  causalToAgentId: string | null;
  causalDeliveryStatus: string | null;
};

function isLocalSpecialistIntegration(candidate: Pick<ClaimCandidate,
  'agentId' | 'causalMessageType' | 'causalKind' | 'causalFromAgentId' | 'causalToAgentId' | 'causalDeliveryStatus'>) {
  return candidate.agentId === GENERAL_MANAGER_ID
    && candidate.causalKind === 'RESULT'
    && candidate.causalMessageType === 'SPECIALIST_RESULT'
    && (candidate.causalFromAgentId === SYSTEMS_MANAGER_ID || candidate.causalFromAgentId === COMPANY_OS_DATA_MANAGER_IDENTITY)
    && candidate.causalToAgentId === GENERAL_MANAGER_ID
    && candidate.causalDeliveryStatus === 'DELIVERED';
}

function adaptiveBudgetFloors(candidate: ClaimCandidate) {
  return isLocalSpecialistIntegration(candidate)
    ? { inputAllowanceTokens: 5_000, minimumOutputTokens: 512 }
    : {};
}

function runtimeContextMessages<T extends {
  kind: string; messageType: string | null; fromAgentId: string | null;
}>(candidate: ClaimCandidate, messages: T[], compactLocalIntegration: boolean): T[] {
  if (!compactLocalIntegration || !isLocalSpecialistIntegration(candidate)) return messages;
  return messages.filter((message) => !(message.kind === 'RESULT'
    && message.messageType === 'MANAGER_RESULT' && message.fromAgentId === GENERAL_MANAGER_ID));
}

export async function claimCompanyOsRuntimeWork(input: { workerId: string; instanceId: string }) {
  const db = companyOsV3Prisma();
  return db.$transaction(async (tx) => {
    const now = new Date();
    await expireLeases(tx, now);
    const control = await tx.companyOsRuntimeControl.findUniqueOrThrow({ where: { id: 'primary' } });
    if (control.paused) return null;
    const slots = await tx.$queryRaw<Array<{ slotNo: number }>>(Prisma.sql`
      SELECT "slotNo"
      FROM public."CompanyOsRuntimeSlot"
      WHERE "slotNo" <= ${control.globalConcurrency}
        AND ("leaseToken" IS NULL OR "expiresAt" <= ${now})
      ORDER BY "slotNo"
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);
    const slot = slots[0];
    if (!slot) return null;
    const selectCandidates = (workItemId: string | null) => tx.$queryRaw<ClaimCandidate[]>(Prisma.sql`
      SELECT
        work.id AS "workItemId", work."caseId", company_case."requestId", work."agentId",
        company_case.objective, work."inputPayload"->>'objective' AS "workObjective",
        company_case.status AS "caseStatus", company_case."caseType",
        company_case."maxOutputTokens", company_case."targetTotalTokens",
        company_case."turnCount", company_case."maxTurns",
        work.status AS "workStatus", work."attemptCount", work."maxAttempts",
        work."timeoutMs", work."reservedTokens", contract."contractVersion",
        contract."handlerKey", contract.contract, causal.kind AS "causalKind",
        causal."messageType" AS "causalMessageType", causal."fromAgentId" AS "causalFromAgentId",
        causal."toAgentId" AS "causalToAgentId", causal."deliveryStatus" AS "causalDeliveryStatus"
      FROM public."CompanyOsWorkItem" work
      JOIN public."CompanyOsCase" company_case ON company_case.id = work."caseId"
      LEFT JOIN public."CompanyOsMessage" causal ON causal.id = work."causalMessageId"
        AND causal."caseId" = work."caseId"
      JOIN LATERAL (
        SELECT installed."contractVersion", installed."handlerKey", installed.contract
        FROM public."CompanyOsAgentContract" installed
        WHERE installed."agentId" = work."agentId" AND installed.status = 'INSTALLED'
        ORDER BY installed."createdAt" DESC
        LIMIT 1
      ) contract ON true
      WHERE work.status IN ('QUEUED','FAILED_RETRYABLE')
        AND (${workItemId}::text IS NULL OR work.id = ${workItemId})
        AND COALESCE(work."nextAttemptAt", work."availableAt") <= ${now}
        AND company_case.status NOT IN ('COMPLETED','CANCELLED','FAILED_FINAL')
        AND (company_case."caseType" <> 'CONTINUOUS_OBJECTIVE' OR EXISTS (
          SELECT 1 FROM public."CompanyOsObjectiveUnit" linked WHERE linked."caseId" = work."caseId"
        ))
        AND NOT EXISTS (
          SELECT 1 FROM public."CompanyOsObjectiveUnit" unit
          JOIN public."CompanyOsContinuousObjective" objective ON objective.id = unit."goalId"
          WHERE unit."caseId" = work."caseId"
            AND (objective.status <> 'ACTIVE' OR objective."startsAt" > clock_timestamp() OR objective."endsAt" <= clock_timestamp())
        )
        AND NOT EXISTS (
          SELECT 1 FROM public."CompanyOsLease" active
          WHERE active."agentId" = work."agentId"
            AND active.status = 'ACTIVE' AND active."expiresAt" > ${now}
        )
      ORDER BY work.priority DESC, work."availableAt", work."createdAt"
      ${workItemId === null ? Prisma.empty : Prisma.sql`FOR UPDATE OF work SKIP LOCKED`}
      LIMIT 1
    `);
    const observed = (await selectCandidates(null))[0];
    if (!observed) return null;
    const candidate = await withRuntimeObjectiveClaimFence(tx, observed, async () => (await selectCandidates(observed.workItemId))[0] ?? null);
    if (!candidate) return null;
    if (candidate.turnCount >= candidate.maxTurns) {
      await tx.companyOsWorkItem.update({ where: { id: candidate.workItemId }, data: { status: 'BLOCKED' } });
      if (!TERMINAL_CASE_STATUSES.has(candidate.caseStatus) && candidate.caseStatus !== 'BLOCKED') {
        await tx.companyOsCase.update({ where: { id: candidate.caseId }, data: { status: 'BLOCKED' } });
      }
      await appendRuntimeEvent(tx, {
        caseId: candidate.caseId,
        requestId: candidate.requestId,
        eventType: 'CASE_BLOCKED_MAX_TURNS',
        fromStatus: candidate.caseStatus,
        toStatus: 'BLOCKED',
        payload: { workItemId: candidate.workItemId, turnCount: candidate.turnCount, maxTurns: candidate.maxTurns },
        idempotencyKey: `runtime:${candidate.requestId}:max-turns:${candidate.workItemId}`,
      });
      return null;
    }
    const runtimeContract = getCompanyOsRuntimeContract(candidate.agentId);
    if (candidate.contractVersion !== runtimeContract.version
      || candidate.handlerKey !== runtimeContract.handlerKey
      || canonicalJson(candidate.contract) !== canonicalJson(runtimeContract)) {
      throw new Error(`Contrato persistido de ${candidate.agentId} no coincide con el handler instalado`);
    }
    const dailyLimit = runtimeContract.budgets.dailyTokens;
    const monthlyLimit = runtimeContract.budgets.monthlyTokens;
    const [dailyUsage, monthlyUsage, activeReserved] = await Promise.all([
      runtimeUsageTotals(tx, candidate.agentId, startOfZonedPeriod(now, 'day')),
      runtimeUsageTotals(tx, candidate.agentId, startOfZonedPeriod(now, 'month')),
      tx.companyOsLease.aggregate({ where: { agentId: candidate.agentId, status: 'ACTIVE', expiresAt: { gt: now } }, _sum: { reservedTokens: true } }),
    ]);
    const dailyUsed = dailyUsage.totalTokens;
    const monthlyUsed = monthlyUsage.totalTokens;
    const reserved = activeReserved._sum.reservedTokens ?? 0;
    const dataPolicy = await resolveCompanyOsRuntimeDataPolicy(tx, candidate.caseId, candidate.agentId);
    // Only the single-call local objective path can shrink its output allowance.
    // Standard/cloud inference may retry internally and retains its original gate.
    const adaptive = dataPolicy.inference === 'LOCAL_ONLY' && dataPolicy.reason === 'CONTINUOUS_OBJECTIVE'
      && await adaptiveLocalCaseEnabled(tx, candidate.caseId)
      ? planAdaptiveRuntimeBudget({ now, dailyUsed, monthlyUsed, reserved,
        requested: candidate.reservedTokens, dailyLimit, monthlyLimit,
        targetTotalTokens: candidate.targetTotalTokens, maxOutputTokens: candidate.maxOutputTokens,
        ...adaptiveBudgetFloors(candidate) })
      : null;
    const claimReservation = adaptive?.requestedTokens ?? candidate.reservedTokens;
    const claimMaxOutput = adaptive?.maxOutputTokens ?? candidate.maxOutputTokens;
    const claimTargetTotal = adaptive?.targetTotalTokens ?? candidate.targetTotalTokens;
    const budgetPlan = adaptive ?? planRuntimeBudget({ now, dailyUsed, monthlyUsed, reserved, requested: claimReservation, dailyLimit, monthlyLimit });
    if (!budgetPlan.allowed && budgetPlan.retryAt) {
      await tx.companyOsWorkItem.update({ where: { id: candidate.workItemId }, data: {
        status: 'QUEUED', availableAt: budgetPlan.retryAt, nextAttemptAt: null,
      } });
      await appendRuntimeEvent(tx, {
        caseId: candidate.caseId, requestId: candidate.requestId,
        eventType: 'WORK_DEFERRED_RUNTIME_BUDGET',
        fromStatus: candidate.caseStatus, toStatus: candidate.caseStatus,
        payload: { workItemId: candidate.workItemId, agentId: candidate.agentId, dailyUsed, monthlyUsed, reserved, requested: candidate.reservedTokens, reason: budgetPlan.reason, retryAt: budgetPlan.retryAt.toISOString(), modelCalls: 0 },
        idempotencyKey: `runtime:${candidate.requestId}:budget-deferred:${candidate.workItemId}:${budgetPlan.retryAt.toISOString()}`,
      });
      return null;
    }
    if (!budgetPlan.allowed) {
      await tx.companyOsWorkItem.update({ where: { id: candidate.workItemId }, data: { status: 'BLOCKED' } });
      if (!TERMINAL_CASE_STATUSES.has(candidate.caseStatus)) {
        await tx.companyOsCase.update({ where: { id: candidate.caseId }, data: { status: 'BLOCKED' } });
      }
      await appendRuntimeEvent(tx, {
        caseId: candidate.caseId,
        requestId: candidate.requestId,
        eventType: 'CASE_BLOCKED_RUNTIME_BUDGET',
        fromStatus: candidate.caseStatus,
        toStatus: 'BLOCKED',
        payload: { workItemId: candidate.workItemId, agentId: candidate.agentId, dailyUsed, monthlyUsed, reserved, requested: candidate.reservedTokens, reason: budgetPlan.reason },
        idempotencyKey: `runtime:${candidate.requestId}:budget:${candidate.workItemId}:${candidate.attemptCount + 1}`,
      });
      return null;
    }
    const evidence = await tx.companyOsEvidenceRef.findMany({ where: { caseId: candidate.caseId }, orderBy: { evidenceKey: 'asc' } });
    const contextMessages = await tx.companyOsMessage.findMany({
      where: { caseId: candidate.caseId },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { id: true, role: true, kind: true, messageType: true, fromAgentId: true, toAgentId: true, content: true, payload: true, createdAt: true },
    });
    const evidencePayload = Object.fromEntries(evidence.map((item) => [item.evidenceKey, item.value]));
    const orderedContextMessages = runtimeContextMessages(candidate, contextMessages.reverse(), adaptive !== null);
    const inputBudget = claimTargetTotal - claimMaxOutput;
    const effectiveInputTokens = estimateJsonTokens({
      requestId: candidate.requestId,
      caseId: candidate.caseId,
      agentId: candidate.agentId,
      objective: candidate.workObjective?.trim() || candidate.objective,
      evidencePayload,
      contextMessages: orderedContextMessages,
      budgets: { maxOutputTokens: claimMaxOutput, targetTotalTokens: claimTargetTotal },
    });
    if (inputBudget <= 0 || effectiveInputTokens > inputBudget) {
      await tx.companyOsWorkItem.update({ where: { id: candidate.workItemId }, data: { status: 'BLOCKED' } });
      if (!TERMINAL_CASE_STATUSES.has(candidate.caseStatus) && candidate.caseStatus !== 'BLOCKED') {
        await tx.companyOsCase.update({ where: { id: candidate.caseId }, data: { status: 'BLOCKED' } });
      }
      await appendRuntimeEvent(tx, {
        caseId: candidate.caseId,
        requestId: candidate.requestId,
        eventType: 'CASE_BLOCKED_EFFECTIVE_INPUT_BUDGET',
        fromStatus: candidate.caseStatus,
        toStatus: 'BLOCKED',
        payload: { workItemId: candidate.workItemId, effectiveInputTokens, inputBudget, modelCalls: 0 },
        idempotencyKey: `runtime:${candidate.requestId}:effective-input-budget:${candidate.workItemId}:${candidate.attemptCount + 1}`,
      });
      return null;
    }
    const leaseToken = randomUUID();
    const expiresAt = new Date(now.getTime() + (control.leaseMs || DEFAULT_LEASE_MS));
    const globalAttempt = await tx.companyOsExecutionAttempt.count({ where: { requestId: candidate.requestId } }) + 1;
    const workAttempt = candidate.attemptCount + 1;
    const lease = await tx.companyOsLease.create({ data: {
      caseId: candidate.caseId,
      requestId: candidate.requestId,
      leaseToken,
      ownerRef: input.workerId,
      workItemId: candidate.workItemId,
      agentId: candidate.agentId,
      workerId: input.workerId,
      instanceId: input.instanceId,
      slotNo: slot.slotNo,
      renewedAt: now,
      reservedTokens: claimReservation,
      expiresAt,
    } });
    const attempt = await tx.companyOsExecutionAttempt.create({ data: {
      caseId: candidate.caseId,
      requestId: candidate.requestId,
      leaseToken,
      attempt: globalAttempt,
      outcome: 'STARTED',
      workItemId: candidate.workItemId,
      agentId: candidate.agentId,
      workerId: input.workerId,
      instanceId: input.instanceId,
      timeoutAt: new Date(now.getTime() + candidate.timeoutMs),
    } });
    await tx.companyOsRuntimeSlot.update({ where: { slotNo: slot.slotNo }, data: {
      leaseToken, agentId: candidate.agentId, workerId: input.workerId, expiresAt,
    } });
    await tx.companyOsWorkItem.update({ where: { id: candidate.workItemId }, data: {
      status: 'CLAIMED', attemptCount: workAttempt, nextAttemptAt: null,
    } });
    let caseToStatus = candidate.caseStatus;
    if (['QUEUED', 'FAILED_RETRYABLE'].includes(candidate.caseStatus)) {
      caseToStatus = 'CLAIMED';
      await tx.companyOsCase.update({ where: { id: candidate.caseId }, data: { status: caseToStatus, nextAttemptAt: null } });
    }
    await tx.companyOsHeartbeat.create({ data: {
      caseId: candidate.caseId,
      requestId: candidate.requestId,
      leaseToken,
      workerRef: input.workerId,
      phase: 'CLAIMED',
    } });
    await appendRuntimeEvent(tx, {
      caseId: candidate.caseId,
      requestId: candidate.requestId,
      eventType: 'RUNTIME_WORK_CLAIMED',
      fromStatus: candidate.caseStatus,
      toStatus: caseToStatus,
      payload: { workItemId: candidate.workItemId, agentId: candidate.agentId, workAttempt, slotNo: slot.slotNo, workerId: input.workerId, dataPolicy,
        budget: { adapted: adaptive?.adapted ?? false, originalReservation: candidate.reservedTokens,
          reservedTokens: claimReservation, maxOutputTokens: claimMaxOutput, targetTotalTokens: claimTargetTotal, inputBudget } },
      idempotencyKey: `runtime:${candidate.requestId}:claim:${candidate.workItemId}:${workAttempt}`,
    });
    return {
      caseId: candidate.caseId,
      requestId: candidate.requestId,
      workItemId: candidate.workItemId,
      agentId: candidate.agentId,
      objective: candidate.workObjective?.trim() || candidate.objective,
      leaseToken,
      leaseExpiresAt: expiresAt.toISOString(),
      attemptId: attempt.id,
      attempt: workAttempt,
      slotNo: slot.slotNo,
      handlerKey: candidate.handlerKey,
      contractVersion: candidate.contractVersion,
      contract: runtimeContract,
      dataPolicy,
      evidencePayload,
      contextMessages: orderedContextMessages,
      budgets: {
        input: inputBudget,
        effectiveInputTokens,
        maxOutputTokens: claimMaxOutput,
        targetTotalTokens: claimTargetTotal,
        dailyRemainingTokens: Math.max(0, dailyLimit - dailyUsed - reserved),
        monthlyRemainingTokens: Math.max(0, monthlyLimit - monthlyUsed - reserved),
      },
      timeoutMs: candidate.timeoutMs,
      advisoryOnly: true,
      businessWritesAuthorized: 0,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function requireRuntimeLease(tx: Tx, input: {
  workItemId: string;
  requestId: string;
  leaseToken: string;
  workerId: string;
  instanceId: string;
}) {
  const lease = await tx.companyOsLease.findFirst({ where: {
    workItemId: input.workItemId,
    requestId: input.requestId,
    leaseToken: input.leaseToken,
    workerId: input.workerId,
    instanceId: input.instanceId,
    status: 'ACTIVE',
    expiresAt: { gt: new Date() },
  } });
  if (!lease) throw new Error('Lease inválido, vencido o asignado a otra instancia');
  return lease;
}

async function releaseRuntimeLease(tx: Tx, lease: {
  id: string;
  leaseToken: string;
  slotNo: number | null;
}, status: 'COMPLETED' | 'FAILED' | 'RELEASED') {
  const now = new Date();
  await tx.companyOsLease.update({ where: { id: lease.id }, data: { status, releasedAt: now } });
  if (lease.slotNo) await tx.companyOsRuntimeSlot.updateMany({
    where: { slotNo: lease.slotNo, leaseToken: lease.leaseToken },
    data: { leaseToken: null, agentId: null, workerId: null, expiresAt: null },
  });
}

export async function heartbeatCompanyOsRuntimeWork(input: {
  workItemId: string;
  requestId: string;
  leaseToken: string;
  workerId: string;
  instanceId: string;
  phase?: string;
}) {
  const db = companyOsV3Prisma();
  return db.$transaction(async (tx) => {
    const lease = await requireRuntimeLease(tx, input);
    const control = await tx.companyOsRuntimeControl.findUniqueOrThrow({ where: { id: 'primary' } });
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (control.leaseMs || DEFAULT_LEASE_MS));
    await tx.companyOsLease.update({ where: { id: lease.id }, data: { expiresAt, renewedAt: now } });
    if (lease.slotNo) await tx.companyOsRuntimeSlot.updateMany({
      where: { slotNo: lease.slotNo, leaseToken: input.leaseToken },
      data: { expiresAt },
    });
    const workItem = await tx.companyOsWorkItem.findUniqueOrThrow({ where: { id: input.workItemId } });
    const companyCase = await tx.companyOsCase.findUniqueOrThrow({ where: { requestId: input.requestId } });
    if (workItem.status === 'CLAIMED') {
      await tx.companyOsWorkItem.update({ where: { id: workItem.id }, data: { status: 'RUNNING' } });
    }
    if (companyCase.status === 'CLAIMED') {
      await tx.companyOsCase.update({ where: { id: companyCase.id }, data: { status: 'RUNNING' } });
      await appendRuntimeEvent(tx, {
        caseId: companyCase.id,
        requestId: companyCase.requestId,
        eventType: 'RUNTIME_WORK_STARTED',
        fromStatus: 'CLAIMED',
        toStatus: 'RUNNING',
        payload: { workItemId: workItem.id, agentId: workItem.agentId, workerId: input.workerId },
        idempotencyKey: `runtime:${companyCase.requestId}:started:${workItem.id}:${workItem.attemptCount}`,
      });
    }
    await tx.companyOsHeartbeat.create({ data: {
      caseId: companyCase.id,
      requestId: companyCase.requestId,
      leaseToken: input.leaseToken,
      workerRef: input.workerId,
      phase: cleanText(input.phase ?? 'RUNNING', 80),
    } });
    return { renewed: true, leaseExpiresAt: expiresAt.toISOString(), paused: control.paused };
  });
}

export function estimateRuntimeCost(usage: CompanyOsWorkerUsage) {
  if (usage.provider === 'ollama') return 0;
  const nonCachedInput = Math.max(0, usage.inputTokens - usage.cachedTokens - usage.cacheWriteTokens);
  return (nonCachedInput * 5 + usage.cachedTokens * 0.5 + usage.cacheWriteTokens * 6.25 + usage.outputTokens * 30) / 1_000_000;
}

type RuntimeUsageTotalsRow = {
  totalTokens: bigint | number;
  estimatedCostUsd: Prisma.Decimal | number;
};

async function runtimeUsageTotals(tx: Tx, agentId: string, since: Date) {
  const rows = await tx.$queryRaw<RuntimeUsageTotalsRow[]>(Prisma.sql`
    SELECT
      COALESCE(sum(usage."totalTokens"), 0)::bigint AS "totalTokens",
      COALESCE(sum(usage."estimatedCostUsd"), 0)::numeric AS "estimatedCostUsd"
    FROM public."CompanyOsUsage" usage
    JOIN public."CompanyOsCase" company_case ON company_case.id = usage."caseId"
    WHERE COALESCE(usage."agentId", company_case."agentId") = ${agentId}
      AND usage."createdAt" >= ${since}
  `);
  return {
    totalTokens: Number(rows[0]?.totalTokens ?? 0),
    estimatedCostUsd: Number(rows[0]?.estimatedCostUsd ?? 0),
  };
}

export function normalizeUsageForPersistence(usage: CompanyOsWorkerUsage) {
  return {
    provider: usage.provider === 'ollama' ? 'ollama' : 'openai',
    model: cleanText(usage.model || 'unknown', 120),
    inputTokens: Math.max(0, Math.trunc(usage.inputTokens || 0)),
    cachedTokens: Math.max(0, Math.trunc(usage.cachedTokens || 0)),
    cacheWriteTokens: Math.max(0, Math.trunc(usage.cacheWriteTokens || 0)),
    outputTokens: Math.max(0, Math.trunc(usage.outputTokens || 0)),
    reasoningTokens: Math.max(0, Math.trunc(usage.reasoningTokens || 0)),
    totalTokens: Math.max(0, Math.trunc(usage.totalTokens || 0)),
    responseId: usage.responseId ? cleanText(usage.responseId, 200) : null,
    durationMs: Math.max(0, Math.trunc(usage.durationMs || 0)),
    retries: Math.max(0, Math.trunc(usage.retries || 0)),
    snapshotBytes: Math.max(0, Math.trunc(usage.snapshotBytes || 0)),
    rulesApplied: Array.isArray(usage.rulesApplied) ? usage.rulesApplied.map((item) => cleanText(item, 120)).slice(0, 30) : [],
  };
}

async function persistRuntimeUsage(tx: Tx, input: {
  caseId: string;
  agentId: string;
  workerId: string;
  attemptId: string;
  outcome: 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT';
  usage: CompanyOsWorkerUsage;
}) {
  const usage = normalizeUsageForPersistence(input.usage);
  const existing = await tx.companyOsUsage.findUnique({ where: { attemptId: input.attemptId } });
  if (existing) return existing;
  const start = startOfZonedPeriod(new Date(), 'day');
  const prior = await runtimeUsageTotals(tx, input.agentId, start);
  const estimatedCostUsd = estimateRuntimeCost(input.usage);
  const dailyTotalTokens = prior.totalTokens + usage.totalTokens;
  const dailyCostUsd = prior.estimatedCostUsd + estimatedCostUsd;
  const percentage = Math.round((dailyTotalTokens / DAILY_AGENT_TOKEN_LIMIT) * 100);
  const alertLevel = percentage >= 100 ? 100 : percentage >= 80 ? 80 : null;
  return tx.companyOsUsage.create({ data: {
    caseId: input.caseId,
    agentId: input.agentId,
    workerId: input.workerId,
    attemptId: input.attemptId,
    outcome: input.outcome,
    provider: usage.provider,
    model: usage.model,
    inputTokens: usage.inputTokens,
    cachedTokens: usage.cachedTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    outputTokens: usage.outputTokens,
    reasoningTokens: usage.reasoningTokens,
    totalTokens: usage.totalTokens,
    estimatedCostUsd,
    dailyTotalTokens,
    dailyCostUsd,
    alertLevel,
    responseId: usage.responseId,
    durationMs: usage.durationMs,
    retries: usage.retries,
    snapshotBytes: usage.snapshotBytes,
    rulesApplied: jsonValue(usage.rulesApplied),
  } });
}

function validateRuntimeOutput(
  agentId: string,
  output: unknown,
  evidence: Array<{ evidenceKey: string; value: Prisma.JsonValue }>,
) {
  const result = asRecord(validateCompanyOsRuntimeOutput(agentId, output));
  const knownEvidence = new Set(evidence.map((entry) => entry.evidenceKey));
  const evidenceRefs: unknown[] = [];
  const collectEvidenceRefs = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(collectEvidenceRefs);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value)) {
      if (key === 'evidenceRefs' && Array.isArray(nested)) evidenceRefs.push(...nested);
      else collectEvidenceRefs(nested);
    }
  };
  collectEvidenceRefs(result);
  if (evidenceRefs.some((ref) => typeof ref !== 'string' || !knownEvidence.has(ref))) throw new Error('Resultado con evidencia no materializada');
  const delegations = Array.isArray(result.delegations) ? result.delegations.map(asRecord) : [];
  if (delegations.length > 1) throw new Error('Sólo se permite una delegación durable por turno');
  if (agentId !== GENERAL_MANAGER_ID && delegations.length > 0) throw new Error('Sólo el Gerente General puede delegar trabajo');
  for (const delegation of delegations) {
    if (!INSTALLED_AGENT_IDS.includes(delegation.agentId as typeof INSTALLED_AGENT_IDS[number])
      || delegation.agentId === GENERAL_MANAGER_ID) {
      throw new Error(`Agente delegado ${String(delegation.agentId)} NOT_INSTALLED`);
    }
    if (typeof delegation.objective !== 'string' || !delegation.objective.trim() || delegation.objective.length > 600) throw new Error('Objetivo delegado inválido');
  }
  if (agentId === SYSTEMS_MANAGER_ID) {
    const assetsValue = evidence.find((entry) => entry.evidenceKey === 'assets')?.value;
    const risksValue = evidence.find((entry) => entry.evidenceKey === 'risks')?.value;
    const assets = Array.isArray(assetsValue) ? assetsValue.map(asRecord) : [];
    const risks = Array.isArray(risksValue) ? risksValue.map(asRecord) : [];
    const assetIds = new Set(assets.map((asset) => String(asset.assetId ?? '')));
    const actionableRiskIds = new Set(risks
      .filter((risk) => risk.classification === 'ACTION_REQUIRED')
      .map((risk) => String(risk.riskId ?? '')));
    const actionableRisks = Array.isArray(result.actionableRisks) ? result.actionableRisks.map(asRecord) : [];
    if (actionableRisks.some((risk) =>
      !assetIds.has(String(risk.assetId ?? '')) || !actionableRiskIds.has(String(risk.riskId ?? '')),
    )) throw new Error('Resultado técnico con activo o riesgo no materializado');
  }
  return { result, delegations };
}

export async function completeCompanyOsRuntimeWork(input: {
  workItemId: string;
  requestId: string;
  leaseToken: string;
  workerId: string;
  instanceId: string;
  output: unknown;
  usage: CompanyOsWorkerUsage;
}) {
  const db = companyOsV3Prisma();
  return db.$transaction(async (tx) => {
    const workItem = await tx.companyOsWorkItem.findUnique({ where: { id: input.workItemId } });
    if (!workItem || workItem.caseId === '') throw new Error('Work item inexistente');
    if (workItem.status === 'COMPLETED' || workItem.status === 'NEEDS_REVIEW') {
      return { reused: true, status: workItem.status };
    }
    const lease = await requireRuntimeLease(tx, input);
    const companyCase = await tx.companyOsCase.findUniqueOrThrow({ where: { requestId: input.requestId } });
    if (companyCase.id !== workItem.caseId || companyCase.status === 'CANCELLED') throw new Error('Caso incompatible con el work item');
    const evidence = await tx.companyOsEvidenceRef.findMany({
      where: { caseId: companyCase.id },
      select: { evidenceKey: true, value: true, createdAt: true },
    });
    const { result, delegations } = validateRuntimeOutput(workItem.agentId, input.output, evidence);
    const safeResult = asRecord(sanitizeRuntimeValue(result));
    const usage = normalizeUsageForPersistence(input.usage);
    if (usage.totalTokens > lease.reservedTokens || usage.totalTokens > workItem.reservedTokens || usage.totalTokens > companyCase.targetTotalTokens) {
      throw new Error('Consumo total excede el presupuesto reservado');
    }
    if (workItem.status === 'CLAIMED') await tx.companyOsWorkItem.update({ where: { id: workItem.id }, data: { status: 'RUNNING' } });
    if (companyCase.status === 'CLAIMED') await tx.companyOsCase.update({ where: { id: companyCase.id }, data: { status: 'RUNNING' } });
    const attempt = await tx.companyOsExecutionAttempt.findFirstOrThrow({ where: {
      workItemId: workItem.id,
      leaseToken: input.leaseToken,
      finishedAt: null,
    } });
    const nextTurn = companyCase.turnCount + 1;
    const pendingTurns = await tx.companyOsWorkItem.count({ where: {
      caseId: companyCase.id, id: { not: workItem.id },
      status: { in: ['QUEUED', 'CLAIMED', 'RUNNING', 'FAILED_RETRYABLE'] },
    } });
    const followUpCapacity = runtimeFollowUpCapacity(nextTurn, companyCase.maxTurns, pendingTurns);
    const canContinue = followUpCapacity.canReturnToGeneral;
    const messageKey = `runtime-message:${workItem.id}:attempt:${workItem.attemptCount}:result`;
    const priorResultMessage = await tx.companyOsMessage.findUnique({ where: { idempotencyKey: messageKey } });
    const resultMessage = priorResultMessage ?? await tx.companyOsMessage.create({
      data: {
        caseId: companyCase.id,
        role: 'ASSISTANT',
        kind: 'RESULT',
        content: cleanText(safeResult, 12_000),
        actorRef: input.workerId,
        fromAgentId: workItem.agentId,
        toAgentId: workItem.agentId === GENERAL_MANAGER_ID ? null : GENERAL_MANAGER_ID,
        messageType: workItem.agentId === GENERAL_MANAGER_ID ? 'MANAGER_RESULT' : 'SPECIALIST_RESULT',
        payload: jsonValue(safeResult),
        schemaVersion: 1,
        evidenceRefs: jsonValue(Array.isArray(result.evidenceRefs) ? result.evidenceRefs : []),
        correlationId: companyCase.requestId,
        causationId: workItem.causalMessageId,
        deliveryStatus: 'DELIVERED',
        idempotencyKey: messageKey,
        expectsResponse: workItem.agentId !== GENERAL_MANAGER_ID && canContinue,
        deliveredAt: new Date(),
      },
    });
    let followUpCount = 0;
    let duplicateDelegations = 0;
    let turnBudgetSuppressed = 0;
    const effectiveDelegations: typeof delegations = [];
    if (workItem.agentId === GENERAL_MANAGER_ID && delegations.length) {
      const completedWorks = await tx.companyOsWorkItem.findMany({
        where: { caseId: companyCase.id, status: 'COMPLETED', agentId: { not: GENERAL_MANAGER_ID } },
        select: { id: true, agentId: true, inputPayload: true, createdAt: true,
          attempts: { where: { outcome: 'SUCCEEDED' }, orderBy: { startedAt: 'desc' }, take: 1, select: { startedAt: true } } },
      });
      const completedDelegations = completedWorks.map((prior) => {
        const priorInput = asRecord(prior.inputPayload);
        const evidenceAt = prior.attempts[0]?.startedAt ?? prior.createdAt;
        return {
          workItemId: prior.id, agentId: prior.agentId,
          objective: typeof priorInput.objective === 'string' ? priorInput.objective : companyCase.objective,
          evidenceRefs: Array.isArray(priorInput.evidenceRefs)
            ? priorInput.evidenceRefs.filter((ref): ref is string => typeof ref === 'string')
            : evidence.filter((ref) => ref.createdAt <= evidenceAt).map((ref) => ref.evidenceKey),
        };
      });
      for (const [index, delegation] of delegations.entries()) {
        const objective = cleanText(delegation.objective, 600);
        const delegationEvidenceRefs = (delegation.evidenceRefs as unknown[])
          .filter((value): value is string => typeof value === 'string')
          .map((value) => cleanText(value, 200));
        const targetAgentId = delegation.agentId as typeof INSTALLED_AGENT_IDS[number];
        const completed = findCompletedRuntimeDelegation({ agentId: targetAgentId, objective, evidenceRefs: delegationEvidenceRefs }, completedDelegations);
        if (completed) {
          duplicateDelegations += 1;
          await appendRuntimeEvent(tx, {
            caseId: companyCase.id, requestId: companyCase.requestId,
            eventType: 'DUPLICATE_DELEGATION_SUPPRESSED',
            payload: { workItemId: workItem.id, completedWorkItemId: completed.workItemId,
              agentId: targetAgentId, evidenceRefs: delegationEvidenceRefs, modelCalls: 0 },
            idempotencyKey: `runtime:${companyCase.requestId}:delegation-suppressed:${workItem.id}:${index}`,
          });
          continue;
        }
        effectiveDelegations.push(delegation);
        if (!runtimeFollowUpCapacity(nextTurn, companyCase.maxTurns, pendingTurns + followUpCount * 2).canDelegateToSpecialist) {
          turnBudgetSuppressed += 1;
          await appendRuntimeEvent(tx, {
            caseId: companyCase.id, requestId: companyCase.requestId,
            eventType: 'DELEGATION_TURN_BUDGET_SUPPRESSED',
            payload: { workItemId: workItem.id, agentId: targetAgentId, turn: nextTurn,
              maxTurns: companyCase.maxTurns, pendingTurns, reservedForGeneralIntegration: true },
            idempotencyKey: `runtime:${companyCase.requestId}:delegation-turn-limit:${workItem.id}:${index}`,
          });
          continue;
        }
        const delegationKey = `runtime-message:${workItem.id}:delegation:${index}:${targetAgentId}`;
        const priorDelegationMessage = await tx.companyOsMessage.findUnique({ where: { idempotencyKey: delegationKey } });
        const delegationMessage = priorDelegationMessage ?? await tx.companyOsMessage.create({
          data: {
            caseId: companyCase.id,
            role: 'ASSISTANT',
            kind: 'ORDER',
            content: objective,
            actorRef: workItem.agentId,
            fromAgentId: GENERAL_MANAGER_ID,
            toAgentId: targetAgentId,
            messageType: 'DELEGATION',
            payload: jsonValue({ objective, evidenceRefs: delegationEvidenceRefs }),
            schemaVersion: 1,
            evidenceRefs: jsonValue(delegationEvidenceRefs),
            correlationId: companyCase.requestId,
            causationId: resultMessage.id,
            deliveryStatus: 'DELIVERED',
            idempotencyKey: delegationKey,
            expectsResponse: true,
            deliveredAt: new Date(),
          },
        });
        await tx.companyOsWorkItem.upsert({
          where: { idempotencyKey: `work:${companyCase.requestId}:delegation:${workItem.id}:${index}:${targetAgentId}` },
          update: {},
          create: {
            id: randomUUID(),
            caseId: companyCase.id,
            agentId: targetAgentId,
            triggerType: 'AGENT_MESSAGE',
            priority: Math.max(0, workItem.priority - 1),
            causalMessageId: delegationMessage.id,
            inputPayload: jsonValue({ objective, fromAgentId: GENERAL_MANAGER_ID, evidenceRefs: delegationEvidenceRefs }),
            idempotencyKey: `work:${companyCase.requestId}:delegation:${workItem.id}:${index}:${targetAgentId}`,
            maxAttempts: 3,
            timeoutMs: 120_000,
            reservedTokens: companyCase.targetTotalTokens,
          },
        });
        followUpCount += 1;
      }
    }
    if (workItem.agentId !== GENERAL_MANAGER_ID && canContinue) {
      const specialistAgentId = workItem.agentId as typeof INSTALLED_AGENT_IDS[number];
      await tx.companyOsWorkItem.upsert({
        where: { idempotencyKey: `work:${companyCase.requestId}:specialist-return:${workItem.id}:${GENERAL_MANAGER_ID}` },
        update: {},
        create: {
          id: randomUUID(),
          caseId: companyCase.id,
          agentId: GENERAL_MANAGER_ID,
          triggerType: 'AGENT_MESSAGE',
          priority: workItem.priority,
          causalMessageId: resultMessage.id,
          inputPayload: jsonValue({ objective: 'Integrar la respuesta del especialista y cerrar o escalar el caso.', fromAgentId: specialistAgentId }),
          idempotencyKey: `work:${companyCase.requestId}:specialist-return:${workItem.id}:${GENERAL_MANAGER_ID}`,
          maxAttempts: 3,
          timeoutMs: 120_000,
          reservedTokens: companyCase.targetTotalTokens,
        },
      });
      followUpCount += 1;
    }
    if (Array.isArray(result.missions) && result.missions.length > 0) {
      const missions = result.missions.slice(0, 10).map(asRecord).filter((mission) => typeof mission.title === 'string' && typeof mission.objective === 'string');
      if (missions.length) await tx.companyOsMission.createMany({ data: missions.map((mission) => ({
        caseId: companyCase.id,
        title: cleanText(mission.title, 300),
        rationale: `Propuesta advisory generada por ${workItem.agentId}`,
        expectedOutput: cleanText(mission.objective, 1_000),
        status: 'PLANNED',
      })) });
    }
    const needsHumanDecision = turnBudgetSuppressed > 0 || runtimeResultNeedsReview({
      output: { ...result, delegations: effectiveDelegations },
      agentId: workItem.agentId,
      canContinue,
      minConfidence: getCompanyOsRuntimeContract(workItem.agentId).lowConfidencePolicy.minConfidence,
    });
    await tx.companyOsWorkItem.update({ where: { id: workItem.id }, data: { status: 'COMPLETED', completedAt: new Date() } });
    const [remainingRunnable, remainingBlocked] = await Promise.all([
      tx.companyOsWorkItem.count({ where: {
        caseId: companyCase.id,
        id: { not: workItem.id },
        status: { in: ['QUEUED', 'CLAIMED', 'RUNNING', 'FAILED_RETRYABLE'] },
      } }),
      tx.companyOsWorkItem.count({ where: {
        caseId: companyCase.id,
        id: { not: workItem.id },
        status: { in: ['BLOCKED', 'FAILED_FINAL', 'NEEDS_REVIEW'] },
      } }),
    ]);
    const finalStatus = remainingRunnable > 0
      ? 'RUNNING'
      : needsHumanDecision || remainingBlocked > 0
        ? 'NEEDS_REVIEW'
        : 'COMPLETED';
    await tx.companyOsCase.update({ where: { id: companyCase.id }, data: {
      status: finalStatus,
      turnCount: nextTurn,
      completedAt: finalStatus === 'COMPLETED' ? new Date() : null,
    } });
    await tx.companyOsExecutionAttempt.update({ where: { id: attempt.id }, data: {
      outcome: 'SUCCEEDED',
      model: usage.model,
      durationMs: usage.durationMs,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      estimatedCostUsd: estimateRuntimeCost(input.usage),
      finishedAt: new Date(),
    } });
    const persistedUsage = await persistRuntimeUsage(tx, {
      caseId: companyCase.id,
      agentId: workItem.agentId,
      workerId: input.workerId,
      attemptId: attempt.id,
      outcome: 'SUCCEEDED',
      usage: input.usage,
    });
    await releaseRuntimeLease(tx, lease, 'COMPLETED');
    await appendRuntimeEvent(tx, {
      caseId: companyCase.id,
      requestId: companyCase.requestId,
      eventType: followUpCount > 0 ? 'AGENT_HANDOFF_QUEUED' : 'RUNTIME_WORK_COMPLETED',
      fromStatus: companyCase.status,
      toStatus: finalStatus,
      payload: {
        workItemId: workItem.id,
        agentId: workItem.agentId,
        followUpCount,
        duplicateDelegations,
        turnBudgetSuppressed,
        remainingRunnable,
        remainingBlocked,
        turn: nextTurn,
        totalTokens: usage.totalTokens,
        alertLevel: persistedUsage.alertLevel,
        businessWrites: 0,
        infrastructureWrites: 0,
      },
      idempotencyKey: `runtime:${companyCase.requestId}:completed:${workItem.id}:${workItem.attemptCount}`,
    });
    const completionAuditKey = `audit:runtime:${workItem.id}:${workItem.attemptCount}:completed`;
    const priorCompletionAudit = await tx.companyOsAuditEvent.findUnique({ where: { idempotencyKey: completionAuditKey } });
    if (!priorCompletionAudit) await tx.companyOsAuditEvent.create({
      data: {
        requestId: companyCase.requestId,
        action: 'RUNTIME_WORK_COMPLETED',
        actorRef: input.workerId,
        metadata: jsonValue({ agentId: workItem.agentId, workItemId: workItem.id, businessWrites: 0, infrastructureWrites: 0 }),
        idempotencyKey: completionAuditKey,
      },
    });
    return { reused: false, status: finalStatus, followUpCount, turn: nextTurn, alertLevel: persistedUsage.alertLevel };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

function retryDelayMs(workAttempt: number, workItemId: string) {
  const base = Math.min(15 * 60_000, 30_000 * (2 ** Math.max(0, workAttempt - 1)));
  const jitter = Number.parseInt(hash(`${workItemId}:${workAttempt}`).slice(0, 6), 16) % 10_000;
  return base + jitter;
}

export async function failCompanyOsRuntimeWork(input: {
  workItemId: string;
  requestId: string;
  leaseToken: string;
  workerId: string;
  instanceId: string;
  errorCode: string;
  detail: string;
  retryable: boolean;
  usage?: CompanyOsWorkerUsage;
}) {
  const db = companyOsV3Prisma();
  return db.$transaction(async (tx) => {
    const lease = await requireRuntimeLease(tx, input);
    const workItem = await tx.companyOsWorkItem.findUniqueOrThrow({ where: { id: input.workItemId } });
    const companyCase = await tx.companyOsCase.findUniqueOrThrow({ where: { requestId: input.requestId } });
    const attempt = await tx.companyOsExecutionAttempt.findFirstOrThrow({ where: {
      workItemId: workItem.id,
      leaseToken: input.leaseToken,
      finishedAt: null,
    } });
    const retryable = input.retryable && workItem.attemptCount < workItem.maxAttempts;
    const nextAttemptAt = retryable ? new Date(Date.now() + retryDelayMs(workItem.attemptCount, workItem.id)) : null;
    const workStatus = retryable ? 'FAILED_RETRYABLE' : 'FAILED_FINAL';
    const outcome = input.errorCode === 'MODEL_TIMEOUT' || input.errorCode === 'LEASE_EXPIRED' ? 'TIMED_OUT' : 'FAILED';
    await tx.companyOsExecutionAttempt.update({ where: { id: attempt.id }, data: {
      outcome,
      errorCode: cleanText(input.errorCode || 'RUNTIME_ERROR', 80),
      detail: cleanText(input.detail || 'Runtime failure', 500),
      model: input.usage?.model ? cleanText(input.usage.model, 120) : null,
      durationMs: input.usage?.durationMs ? Math.max(0, Math.trunc(input.usage.durationMs)) : null,
      inputTokens: input.usage ? Math.max(0, Math.trunc(input.usage.inputTokens)) : null,
      outputTokens: input.usage ? Math.max(0, Math.trunc(input.usage.outputTokens)) : null,
      totalTokens: input.usage ? Math.max(0, Math.trunc(input.usage.totalTokens)) : null,
      estimatedCostUsd: input.usage ? estimateRuntimeCost(input.usage) : null,
      finishedAt: new Date(),
    } });
    if (input.usage) await persistRuntimeUsage(tx, {
      caseId: companyCase.id,
      agentId: workItem.agentId,
      workerId: input.workerId,
      attemptId: attempt.id,
      outcome,
      usage: input.usage,
    });
    await tx.companyOsWorkItem.update({ where: { id: workItem.id }, data: {
      status: workStatus,
      nextAttemptAt,
    } });
    await releaseRuntimeLease(tx, lease, 'FAILED');
    const otherActive = await tx.companyOsWorkItem.count({ where: {
      caseId: companyCase.id,
      id: { not: workItem.id },
      status: { in: [...ACTIVE_WORK_STATUSES] },
    } });
    const caseStatus = otherActive > 0 ? companyCase.status : workStatus;
    if (caseStatus !== companyCase.status && !TERMINAL_CASE_STATUSES.has(companyCase.status)) {
      await tx.companyOsCase.update({ where: { id: companyCase.id }, data: { status: caseStatus, nextAttemptAt } });
    }
    await appendRuntimeEvent(tx, {
      caseId: companyCase.id,
      requestId: companyCase.requestId,
      eventType: retryable ? 'RUNTIME_WORK_FAILED_RETRYABLE' : 'RUNTIME_WORK_FAILED_FINAL',
      fromStatus: companyCase.status,
      toStatus: caseStatus,
      payload: {
        workItemId: workItem.id,
        agentId: workItem.agentId,
        attempt: workItem.attemptCount,
        maxAttempts: workItem.maxAttempts,
        errorCode: cleanText(input.errorCode, 80),
        nextAttemptAt: nextAttemptAt?.toISOString() ?? null,
      },
      idempotencyKey: `runtime:${companyCase.requestId}:failed:${workItem.id}:${workItem.attemptCount}`,
    });
    const failureAuditKey = `audit:runtime:${workItem.id}:${workItem.attemptCount}:failed`;
    const priorFailureAudit = await tx.companyOsAuditEvent.findUnique({ where: { idempotencyKey: failureAuditKey } });
    if (!priorFailureAudit) await tx.companyOsAuditEvent.create({
      data: {
        requestId: companyCase.requestId,
        action: retryable ? 'RUNTIME_WORK_FAILED_RETRYABLE' : 'RUNTIME_WORK_FAILED_FINAL',
        actorRef: input.workerId,
        metadata: jsonValue({ agentId: workItem.agentId, workItemId: workItem.id, businessWrites: 0, infrastructureWrites: 0 }),
        idempotencyKey: failureAuditKey,
      },
    });
    return { status: workStatus, retryable, nextAttemptAt: nextAttemptAt?.toISOString() ?? null };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

const WORKER_STATES = new Set(['STARTING', 'IDLE', 'BUSY', 'DEGRADED', 'DRAINING', 'STOPPED']);
const DEPENDENCY_STATES = new Set(['HEALTHY', 'DEGRADED', 'UNAVAILABLE', 'UNOBSERVED']);

export async function recordCompanyOsWorkerHeartbeat(input: {
  workerId: string;
  instanceId: string;
  host: string;
  version: string;
  state: string;
  startedAt: string;
  currentWork?: unknown[];
  capacity?: number;
  allowedAgentIds?: string[];
  lastErrorCode?: string | null;
  dependencies?: Array<{ key: string; status: string; observedAt?: string; latencyMs?: number | null; detail?: string | null; caseId?: string | null }>;
}) {
  if (!WORKER_STATES.has(input.state)) throw new Error('Estado de worker inválido');
  const startedAt = new Date(input.startedAt);
  if (Number.isNaN(startedAt.getTime())) throw new Error('startedAt inválido');
  const now = new Date();
  const currentWork = Array.isArray(input.currentWork) ? input.currentWork.slice(0, 2) : [];
  const db = companyOsV3Prisma();
  return db.$transaction(async (tx) => {
    await tx.companyOsWorker.upsert({
      where: { workerId: input.workerId },
      update: {
        instanceId: input.instanceId,
        host: cleanText(input.host, 160),
        version: cleanText(input.version, 80),
        state: input.state,
        startedAt,
        lastHeartbeatAt: now,
        currentWork: jsonValue(currentWork),
        capacity: Math.min(2, positiveInteger(input.capacity, 2)),
        allowedAgentIds: (input.allowedAgentIds ?? []).filter(isCompanyOsRuntimeAgentInstalled),
        lastErrorCode: input.lastErrorCode ? cleanText(input.lastErrorCode, 80) : null,
      },
      create: {
        workerId: input.workerId,
        instanceId: input.instanceId,
        host: cleanText(input.host, 160),
        version: cleanText(input.version, 80),
        state: input.state,
        startedAt,
        lastHeartbeatAt: now,
        currentWork: jsonValue(currentWork),
        capacity: Math.min(2, positiveInteger(input.capacity, 2)),
        allowedAgentIds: (input.allowedAgentIds ?? []).filter(isCompanyOsRuntimeAgentInstalled),
        lastErrorCode: input.lastErrorCode ? cleanText(input.lastErrorCode, 80) : null,
      },
    });
    await tx.companyOsWorkerHeartbeat.create({ data: {
      id: randomUUID(),
      workerId: input.workerId,
      instanceId: input.instanceId,
      state: input.state,
      currentWork: jsonValue(currentWork),
      host: cleanText(input.host, 160),
      version: cleanText(input.version, 80),
      observedAt: now,
    } });
    for (const dependency of (input.dependencies ?? []).slice(0, 20)) {
      if (!DEPENDENCY_STATES.has(dependency.status)) continue;
      const observedAt = dependency.observedAt ? new Date(dependency.observedAt) : now;
      await tx.companyOsDependencyObservation.create({ data: {
        id: randomUUID(),
        dependencyKey: cleanText(dependency.key, 120),
        status: dependency.status,
        workerId: input.workerId,
        caseId: dependency.caseId ?? null,
        latencyMs: dependency.latencyMs == null ? null : Math.max(0, Math.trunc(dependency.latencyMs)),
        detail: dependency.detail ? cleanText(dependency.detail, 500) : null,
        observedAt: Number.isNaN(observedAt.getTime()) ? now : observedAt,
      } });
    }
    return { recorded: true, observedAt: now.toISOString() };
  });
}

async function upsertIncident(tx: Tx, input: {
  dedupeKey: string;
  type: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  summary: string;
  detail?: Record<string, unknown>;
}, now: Date) {
  return tx.companyOsIncident.upsert({
    where: { dedupeKey: input.dedupeKey },
    update: {
      type: input.type,
      severity: input.severity,
      status: 'OPEN',
      summary: cleanText(input.summary, 500),
      detail: jsonValue(input.detail ?? {}),
      occurrenceCount: { increment: 1 },
      lastSeenAt: now,
    },
    create: {
      id: randomUUID(),
      dedupeKey: input.dedupeKey,
      type: input.type,
      severity: input.severity,
      status: 'OPEN',
      summary: cleanText(input.summary, 500),
      detail: jsonValue(input.detail ?? {}),
      firstSeenAt: now,
      lastSeenAt: now,
    },
  });
}

async function recoverBudgetBlockedWork(tx: Tx, now: Date) {
  const blocked = await tx.$queryRaw<Array<{
    workItemId: string; caseId: string; requestId: string; agentId: string;
    caseStatus: string; reservedTokens: number; budgetAt: Date; payload: Prisma.JsonValue;
  }>>(Prisma.sql`
    SELECT work.id AS "workItemId", work."caseId", company_case."requestId", work."agentId",
      company_case.status AS "caseStatus", work."reservedTokens", budget."createdAt" AS "budgetAt", budget.payload
    FROM public."CompanyOsWorkItem" work
    JOIN public."CompanyOsCase" company_case ON company_case.id = work."caseId"
    JOIN LATERAL (
      SELECT event.sequence, event."createdAt", event.payload
      FROM public."CompanyOsCaseEvent" event
      WHERE event."caseId" = work."caseId" AND event."eventType" = 'CASE_BLOCKED_RUNTIME_BUDGET'
        AND event."idempotencyKey" = 'runtime:' || company_case."requestId" || ':budget:' || work.id || ':' || (work."attemptCount" + 1)::text
      ORDER BY event.sequence DESC LIMIT 1
    ) budget ON true
    WHERE work.status = 'BLOCKED' AND company_case.status IN ('BLOCKED','QUEUED')
      AND company_case."turnCount" < company_case."maxTurns"
      AND NOT EXISTS (
        SELECT 1 FROM public."CompanyOsCaseEvent" newer
        WHERE newer."caseId" = work."caseId" AND newer.sequence > budget.sequence
          AND newer."toStatus" IN ('BLOCKED','CANCELLED','FAILED_FINAL','NEEDS_REVIEW')
          AND newer."eventType" <> 'CASE_BLOCKED_RUNTIME_BUDGET'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public."CompanyOsLease" lease
        WHERE lease."caseId" = work."caseId" AND lease.status = 'ACTIVE' AND lease."expiresAt" > ${now}
      )
    ORDER BY budget."createdAt", work.id
    FOR UPDATE OF work SKIP LOCKED LIMIT 25
  `);
  let recovered = 0;
  for (const work of blocked) {
    if (!isCompanyOsRuntimeAgentInstalled(work.agentId)) continue;
    const payload = work.payload && typeof work.payload === 'object' && !Array.isArray(work.payload) ? work.payload : {};
    const { dailyUsed, monthlyUsed, reserved } = payload;
    if (![dailyUsed, monthlyUsed, reserved].every((value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)) continue;
    const contract = getCompanyOsRuntimeContract(work.agentId);
    const plan = planRuntimeBudget({
      now: work.budgetAt, dailyUsed: dailyUsed as number, monthlyUsed: monthlyUsed as number, reserved: reserved as number,
      requested: work.reservedTokens, dailyLimit: contract.budgets.dailyTokens, monthlyLimit: contract.budgets.monthlyTokens,
    });
    if (plan.allowed || !plan.retryAt) continue;
    const availableAt = new Date(Math.max(now.getTime(), plan.retryAt.getTime()));
    await tx.companyOsWorkItem.update({ where: { id: work.workItemId }, data: { status: 'QUEUED', availableAt, nextAttemptAt: null } });
    if (work.caseStatus === 'BLOCKED') {
      await tx.companyOsCase.update({ where: { id: work.caseId }, data: { status: 'QUEUED', nextAttemptAt: null } });
    }
    await appendRuntimeEvent(tx, {
      caseId: work.caseId, requestId: work.requestId, eventType: 'WORK_BUDGET_AUTO_RECOVERED',
      fromStatus: work.caseStatus, toStatus: work.caseStatus === 'BLOCKED' ? 'QUEUED' : work.caseStatus,
      payload: { workItemId: work.workItemId, agentId: work.agentId, retryAt: availableAt.toISOString(), reason: plan.reason, modelCalls: 0 },
      idempotencyKey: `runtime:${work.requestId}:budget-auto-recovered:${work.workItemId}:${work.budgetAt.toISOString()}`,
    });
    recovered += 1;
  }
  return recovered;
}

/** Reconsider only a budget-imposed delay, never a human pause or retry backoff. */
export async function reconsiderLocalObjectiveBudget(tx: Tx, now: Date) {
  const goalIds = adaptiveLocalGoalIds();
  if (goalIds.length === 0) return 0;
  const deferred = await tx.$queryRaw<Array<{
    workItemId: string; caseId: string; requestId: string; agentId: string;
    reservedTokens: number; targetTotalTokens: number; maxOutputTokens: number;
    availableAt: Date; caseStatus: string; budgetEventId: string;
    causalMessageType: string | null; causalKind: string | null; causalFromAgentId: string | null;
    causalToAgentId: string | null; causalDeliveryStatus: string | null;
  }>>(Prisma.sql`
    SELECT work.id AS "workItemId", work."caseId", company_case."requestId", work."agentId",
      work."reservedTokens", company_case."targetTotalTokens", company_case."maxOutputTokens",
      work."availableAt", company_case.status AS "caseStatus", budget.id AS "budgetEventId",
      causal.kind AS "causalKind", causal."messageType" AS "causalMessageType",
      causal."fromAgentId" AS "causalFromAgentId", causal."toAgentId" AS "causalToAgentId",
      causal."deliveryStatus" AS "causalDeliveryStatus"
    FROM public."CompanyOsWorkItem" work
    JOIN public."CompanyOsCase" company_case ON company_case.id = work."caseId"
    LEFT JOIN public."CompanyOsMessage" causal ON causal.id = work."causalMessageId"
      AND causal."caseId" = work."caseId"
    JOIN LATERAL (
      SELECT event.id, event.sequence, event.payload FROM public."CompanyOsCaseEvent" event
      WHERE event."caseId" = work."caseId" AND event."eventType" = 'WORK_DEFERRED_RUNTIME_BUDGET'
        AND event.payload->>'workItemId' = work.id
      ORDER BY event.sequence DESC LIMIT 1
    ) budget ON true
    WHERE company_case."caseType" = 'CONTINUOUS_OBJECTIVE'
      AND company_case.status IN ('QUEUED','CLAIMED','RUNNING','FAILED_RETRYABLE')
      AND company_case."turnCount" < company_case."maxTurns"
      AND work.status = 'QUEUED' AND work."nextAttemptAt" IS NULL AND work."availableAt" > ${now}
      AND budget.payload->>'retryAt' = to_char(work."availableAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      AND EXISTS (
        SELECT 1 FROM public."CompanyOsObjectiveUnit" unit
        JOIN public."CompanyOsContinuousObjective" objective ON objective.id = unit."goalId"
        WHERE unit."caseId" = work."caseId" AND unit."goalId" IN (${Prisma.join(goalIds)}) AND objective.status = 'ACTIVE'
          AND objective."startsAt" <= ${now} AND objective."endsAt" > ${now}
      )
      AND NOT EXISTS (
        SELECT 1 FROM public."CompanyOsCaseEvent" newer WHERE newer."caseId" = work."caseId"
          AND newer.sequence > budget.sequence AND newer."toStatus" IN ('BLOCKED','CANCELLED','FAILED_FINAL','NEEDS_REVIEW')
      )
      AND NOT EXISTS (
        SELECT 1 FROM public."CompanyOsLease" lease WHERE lease."caseId" = work."caseId"
          AND lease.status = 'ACTIVE' AND lease."expiresAt" > ${now}
      )
    ORDER BY work."createdAt", work.id FOR UPDATE OF work SKIP LOCKED LIMIT 25
  `);
  let reconsidered = 0;
  for (const work of deferred) {
    if (!isCompanyOsRuntimeAgentInstalled(work.agentId)) continue;
    const contract = getCompanyOsRuntimeContract(work.agentId);
    const [daily, monthly, leases] = await Promise.all([
      runtimeUsageTotals(tx, work.agentId, startOfZonedPeriod(now, 'day')),
      runtimeUsageTotals(tx, work.agentId, startOfZonedPeriod(now, 'month')),
      tx.companyOsLease.aggregate({ where: { agentId: work.agentId, status: 'ACTIVE', expiresAt: { gt: now } }, _sum: { reservedTokens: true } }),
    ]);
    const plan = planAdaptiveRuntimeBudget({ now, dailyUsed: daily.totalTokens, monthlyUsed: monthly.totalTokens,
      reserved: leases._sum.reservedTokens ?? 0, requested: work.reservedTokens,
      dailyLimit: contract.budgets.dailyTokens, monthlyLimit: contract.budgets.monthlyTokens,
      targetTotalTokens: work.targetTotalTokens, maxOutputTokens: work.maxOutputTokens,
      ...(isLocalSpecialistIntegration(work) ? { inputAllowanceTokens: 5_000, minimumOutputTokens: 512 } : {}) });
    if (!plan.allowed) continue;
    // No reservation here: claim rechecks usage under its existing serializable fence.
    await tx.companyOsWorkItem.update({ where: { id: work.workItemId }, data: { availableAt: now } });
    await appendRuntimeEvent(tx, {
      caseId: work.caseId, requestId: work.requestId, eventType: 'WORK_BUDGET_RECONSIDERED',
      fromStatus: work.caseStatus, toStatus: work.caseStatus,
      payload: { workItemId: work.workItemId, previousAvailableAt: work.availableAt.toISOString(),
        budgetEventId: work.budgetEventId, reservedTokens: plan.requestedTokens,
        maxOutputTokens: plan.maxOutputTokens, adapted: plan.adapted, modelCalls: 0 },
      idempotencyKey: `runtime:${work.requestId}:budget-reconsidered:${work.workItemId}:${work.budgetEventId}`,
    });
    reconsidered += 1;
  }
  return reconsidered;
}

export async function reconcileCompanyOsRuntime(workerId: string) {
  const db = companyOsV3Prisma();
  return db.$transaction(async (tx) => {
    const now = new Date();
    const expiredLeases = await expireLeases(tx, now);
    const budgetRecovered = await recoverBudgetBlockedWork(tx, now);
    const runtimeControl = await tx.companyOsRuntimeControl.findUniqueOrThrow({ where: { id: 'primary' } });
    const budgetReconsidered = runtimeControl.paused ? 0 : await reconsiderLocalObjectiveBudget(tx, now);
    const detected: Array<{ dedupeKey: string; type: string; severity: 'INFO' | 'WARNING' | 'CRITICAL'; summary: string; detail?: Record<string, unknown> }> = [];
    const staleWorkers = await tx.companyOsWorker.findMany({ where: { lastHeartbeatAt: { lt: new Date(now.getTime() - WORKER_STALE_MS) }, state: { not: 'STOPPED' } } });
    for (const worker of staleWorkers) detected.push({
      dedupeKey: `worker-stale:${worker.workerId}`,
      type: 'WORKER_STALE',
      severity: 'CRITICAL',
      summary: `Telemetría del worker ${worker.workerId} vencida; estado real UNKNOWN`,
      detail: { lastHeartbeatAt: worker.lastHeartbeatAt.toISOString(), priorState: worker.state },
    });
    const oldQueue = await tx.companyOsWorkItem.count({ where: { status: 'QUEUED', availableAt: { lt: new Date(now.getTime() - 15 * 60_000) } } });
    if (oldQueue > 0) detected.push({
      dedupeKey: 'queue-age:15m', type: 'QUEUE_AGE', severity: 'WARNING',
      summary: `${oldQueue} trabajos en cola superan 15 minutos`, detail: { count: oldQueue },
    });
    const missingContracts = await tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT count(*)::bigint AS count
      FROM public."CompanyOsWorkItem" work
      WHERE work.status IN ('QUEUED','FAILED_RETRYABLE')
        AND NOT EXISTS (
          SELECT 1 FROM public."CompanyOsAgentContract" contract
          WHERE contract."agentId" = work."agentId" AND contract.status = 'INSTALLED'
        )
    `);
    const missingContractCount = Number(missingContracts[0]?.count ?? 0);
    if (missingContractCount > 0) detected.push({
      dedupeKey: 'contract-missing', type: 'CONTRACT_MISSING', severity: 'CRITICAL',
      summary: `${missingContractCount} trabajos no tienen contrato ejecutable instalado`, detail: { count: missingContractCount },
    });
    const overdueSchedules = await tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT count(*)::bigint AS count
      FROM public."CompanyOsAgentSchedule"
      WHERE enabled AND "nextRunAt" < ${new Date(now.getTime() - 5 * 60_000)}
    `);
    const overdueScheduleCount = Number(overdueSchedules[0]?.count ?? 0);
    if (overdueScheduleCount > 0) detected.push({
      dedupeKey: 'schedule-overdue:5m', type: 'SCHEDULE_OVERDUE', severity: 'WARNING',
      summary: `${overdueScheduleCount} agendas están vencidas`, detail: { count: overdueScheduleCount },
    });
    const unanswered = await tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT count(*)::bigint AS count
      FROM public."CompanyOsMessage" message
      WHERE message."expectsResponse" = true
        AND message."createdAt" < ${new Date(now.getTime() - 10 * 60_000)}
        AND message."deliveryStatus" = 'DELIVERED'
        AND NOT EXISTS (
          SELECT 1 FROM public."CompanyOsMessage" response
          WHERE response."causationId" = message.id
        )
    `);
    const unansweredCount = Number(unanswered[0]?.count ?? 0);
    if (unansweredCount > 0) detected.push({
      dedupeKey: 'agent-message-unanswered:10m', type: 'UNANSWERED_AGENT_MESSAGE', severity: 'WARNING',
      summary: `${unansweredCount} mensajes entre agentes esperan respuesta`, detail: { count: unansweredCount },
    });
    const dayUsage = await tx.companyOsUsage.groupBy({
      by: ['agentId'],
      where: { createdAt: { gte: startOfZonedPeriod(now, 'day') }, agentId: { not: null } },
      _sum: { totalTokens: true },
    });
    for (const usage of dayUsage) {
      const tokens = usage._sum.totalTokens ?? 0;
      const percentage = Math.round((tokens / DAILY_AGENT_TOKEN_LIMIT) * 100);
      if (percentage >= 80) detected.push({
        dedupeKey: `budget:${usage.agentId}:${percentage >= 100 ? 100 : 80}`,
        type: 'BUDGET_THRESHOLD',
        severity: percentage >= 100 ? 'CRITICAL' : 'WARNING',
        summary: `${usage.agentId} alcanzó ${percentage}% del presupuesto diario`,
        detail: { tokens, limit: DAILY_AGENT_TOKEN_LIMIT, percentage },
      });
    }
    if (expiredLeases > 0) detected.push({
      dedupeKey: `lease-expired:${now.toISOString().slice(0, 13)}`,
      type: 'LEASE_EXPIRED',
      severity: 'WARNING',
      summary: `${expiredLeases} leases vencidos fueron recuperados de forma segura`,
      detail: { expiredLeases, reconciledBy: workerId },
    });
    for (const incident of detected) await upsertIncident(tx, incident, now);
    const activeKeys = detected.map((item) => item.dedupeKey);
    await tx.companyOsIncident.updateMany({
      where: { status: { in: ['OPEN', 'ACKNOWLEDGED'] }, ...(activeKeys.length ? { dedupeKey: { notIn: activeKeys } } : {}) },
      data: { status: 'RESOLVED', lastSeenAt: now },
    });
    return { reconciledAt: now.toISOString(), expiredLeases, budgetRecovered, budgetReconsidered, incidentsOpen: detected.length };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

type RuntimeScheduleRow = {
  id: string;
  agentId: string;
  scheduleKey: string;
  enabled: boolean;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
};

type RuntimeDependencyRow = {
  dependencyKey: string;
  status: string;
  observedAt: Date;
  latencyMs: number | null;
};

type RuntimeUsageRow = {
  agentId: string;
  model: string;
  dailyTokens: bigint | number;
  dailyCostUsd: Prisma.Decimal | number;
  monthlyTokens: bigint | number;
  monthlyCostUsd: Prisma.Decimal | number;
};

export async function getCompanyOsRuntimeControlCenter() {
  const db = companyOsV3Prisma();
  const now = new Date();
  const dayStart = startOfZonedPeriod(now, 'day');
  const monthStart = startOfZonedPeriod(now, 'month');
  const [
    control,
    workers,
    workItems,
    queueGroups,
    schedules,
    usageRows,
    incidents,
    dependencyRows,
    messages,
    reviewCaseCount,
    completedToday,
    oldestQueued,
    agentStateWorkItems,
  ] = await Promise.all([
    db.companyOsRuntimeControl.findUniqueOrThrow({ where: { id: 'primary' } }),
    db.companyOsWorker.findMany({ orderBy: { lastHeartbeatAt: 'desc' } }),
    db.companyOsWorkItem.findMany({
      where: { status: { in: ['QUEUED', 'CLAIMED', 'RUNNING', 'NEEDS_REVIEW', 'COMPLETED', 'BLOCKED', 'FAILED_RETRYABLE', 'FAILED_FINAL'] } },
      include: {
        case: { select: { requestId: true, objective: true } },
        leases: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { status: true, workerId: true, slotNo: true, renewedAt: true, expiresAt: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    }),
    db.companyOsWorkItem.groupBy({ by: ['status'], _count: { _all: true } }),
    db.$queryRaw<RuntimeScheduleRow[]>(Prisma.sql`
      SELECT id, "agentId", "scheduleKey", enabled, "nextRunAt", "lastRunAt"
      FROM public."CompanyOsAgentSchedule"
      ORDER BY enabled DESC, "nextRunAt" NULLS LAST, "createdAt"
    `),
    db.$queryRaw<RuntimeUsageRow[]>(Prisma.sql`
      SELECT
        COALESCE(usage."agentId", company_case."agentId") AS "agentId",
        usage.model,
        COALESCE(sum(usage."totalTokens") FILTER (WHERE usage."createdAt" >= ${dayStart}), 0)::bigint AS "dailyTokens",
        COALESCE(sum(usage."estimatedCostUsd") FILTER (WHERE usage."createdAt" >= ${dayStart}), 0)::numeric AS "dailyCostUsd",
        COALESCE(sum(usage."totalTokens") FILTER (WHERE usage."createdAt" >= ${monthStart}), 0)::bigint AS "monthlyTokens",
        COALESCE(sum(usage."estimatedCostUsd") FILTER (WHERE usage."createdAt" >= ${monthStart}), 0)::numeric AS "monthlyCostUsd"
      FROM public."CompanyOsUsage" usage
      JOIN public."CompanyOsCase" company_case ON company_case.id = usage."caseId"
      WHERE usage."createdAt" >= ${monthStart}
      GROUP BY COALESCE(usage."agentId", company_case."agentId"), usage.model
      ORDER BY "monthlyTokens" DESC
    `),
    db.companyOsIncident.findMany({ orderBy: [{ status: 'asc' }, { lastSeenAt: 'desc' }], take: 100 }),
    db.$queryRaw<RuntimeDependencyRow[]>(Prisma.sql`
      SELECT DISTINCT ON (observation."dependencyKey")
        observation."dependencyKey", observation.status, observation."observedAt", observation."latencyMs"
      FROM public."CompanyOsDependencyObservation" observation
      ORDER BY observation."dependencyKey", observation."observedAt" DESC
    `),
    db.companyOsMessage.findMany({
      where: { OR: [{ fromAgentId: { not: null } }, { toAgentId: { not: null } }] },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, fromAgentId: true, toAgentId: true, messageType: true, deliveryStatus: true, content: true, createdAt: true },
    }),
    db.companyOsCase.count({ where: { status: { in: ['NEEDS_REVIEW', 'AWAITING_REVIEW'] } } }),
    db.companyOsWorkItem.count({ where: { status: 'COMPLETED', completedAt: { gte: dayStart } } }),
    db.companyOsWorkItem.findFirst({
      where: { status: 'QUEUED' },
      orderBy: { availableAt: 'asc' },
      select: { availableAt: true },
    }),
    // Agent health must not depend on the pagination of the visible work history.
    db.$queryRaw<RuntimeAgentStateWork[]>(Prisma.sql`
      SELECT DISTINCT ON (work."agentId", work.status)
        work."agentId", work.status, company_case."requestId", work."updatedAt", work."completedAt",
        active_lease."workerId" AS "leaseWorkerId", active_lease."expiresAt" AS "leaseExpiresAt"
      FROM public."CompanyOsWorkItem" work
      JOIN public."CompanyOsCase" company_case ON company_case.id = work."caseId"
      LEFT JOIN LATERAL (
        SELECT lease."workerId", lease."expiresAt"
        FROM public."CompanyOsLease" lease
        WHERE lease."workItemId" = work.id AND lease.status = 'ACTIVE' AND lease."expiresAt" > ${now}
        ORDER BY lease."createdAt" DESC LIMIT 1
      ) active_lease ON true
      WHERE work."agentId" IN (${Prisma.join(INSTALLED_AGENT_IDS)})
        AND work.status IN ('CLAIMED', 'RUNNING', 'COMPLETED', 'BLOCKED', 'FAILED_RETRYABLE', 'FAILED_FINAL')
      ORDER BY work."agentId", work.status, work."updatedAt" DESC, work.id DESC
    `),
  ]);
  const counts = new Map(queueGroups.map((item) => [item.status, item._count._all]));
  const freshWorkers = workers.filter((worker) => now.getTime() - worker.lastHeartbeatAt.getTime() <= WORKER_STALE_MS && worker.state !== 'STOPPED');
  const agents = COMPANY_OS_TEAM_MANIFEST.map((agent) => {
    const current = deriveRuntimeAgentState({
      agentId: agent.agentId,
      installed: agent.status === 'INSTALLED',
      paused: control.paused,
      now,
      staleMs: WORKER_STALE_MS,
      workers,
      workItems: agentStateWorkItems,
    });
    return {
      agentId: agent.agentId,
      name: agent.name,
      reportsToAgentId: agent.reportsToAgentId,
      installationStatus: agent.status,
      ...current,
    };
  });
  const usageByAgentModel = usageRows.map((row) => ({
    agentId: row.agentId,
    model: row.model,
    dailyTokens: Number(row.dailyTokens),
    dailyCostUsd: Number(row.dailyCostUsd),
    monthlyTokens: Number(row.monthlyTokens),
    monthlyCostUsd: Number(row.monthlyCostUsd),
  }));
  const dependencyByKey = new Map(dependencyRows.map((row) => [row.dependencyKey, row]));
  const dependencyKeys = ['network', 'vercel-api', 'supabase-postgres', 'inference-router', 'openai-api', 'ollama-local', 'openclaw-optional'];
  const dependencies = [...new Set([...dependencyKeys, ...dependencyRows.map((row) => row.dependencyKey)])].map((key) => {
    const observation = dependencyByKey.get(key);
    return observation ? {
      key,
      status: now.getTime() - observation.observedAt.getTime() > DEPENDENCY_STALE_MS
        ? 'UNKNOWN'
        : observation.status,
      observedAt: observation.observedAt.toISOString(),
      latencyMs: observation.latencyMs,
    } : { key, status: 'UNOBSERVED', observedAt: null, latencyMs: null };
  });
  const optionalDependencyKeys = new Set(['openai-api', 'ollama-local', 'openclaw-optional']);
  const requiredDependencies = dependencies.filter((dependency) => !optionalDependencyKeys.has(dependency.key));
  const hasExplicitCriticalState = workers.some((worker) => worker.state === 'STOPPED')
    || incidents.some((incident) => incident.status === 'OPEN' && incident.severity === 'CRITICAL')
    || requiredDependencies.some((dependency) => dependency.status === 'UNAVAILABLE');
  const hasAttentionState = freshWorkers.length === 0
    || incidents.some((incident) => incident.status === 'OPEN')
    || requiredDependencies.some((dependency) => dependency.status === 'DEGRADED');
  const hasUnobservedRequiredDependency = requiredDependencies.some((dependency) => ['UNKNOWN', 'UNOBSERVED'].includes(dependency.status));
  const overallHealth = control.paused
    ? 'PAUSED'
    : hasExplicitCriticalState
      ? 'CRITICAL'
      : hasAttentionState
        ? 'ATTENTION'
        : hasUnobservedRequiredDependency
          ? 'UNOBSERVED'
          : 'HEALTHY';
  const workItemRows = workItems.map((work) => {
    const lease = work.leases[0] ?? null;
    return {
      id: work.id,
      requestId: work.case.requestId,
      objective: cleanText(work.case.objective, 280),
      agentId: work.agentId,
      triggerType: work.triggerType,
      status: work.status,
      priority: work.priority,
      attemptCount: work.attemptCount,
      maxAttempts: work.maxAttempts,
      availableAt: work.availableAt.toISOString(),
      nextAttemptAt: work.nextAttemptAt?.toISOString() ?? null,
      completedAt: work.completedAt?.toISOString() ?? null,
      createdAt: work.createdAt.toISOString(),
      updatedAt: work.updatedAt.toISOString(),
      lease: lease ? {
        status: lease.status,
        workerId: lease.workerId,
        slotNo: lease.slotNo,
        renewedAt: lease.renewedAt.toISOString(),
        expiresAt: lease.expiresAt.toISOString(),
      } : null,
    };
  });
  return {
    generatedAt: now.toISOString(),
    runtime: {
      paused: control.paused,
      globalConcurrency: control.globalConcurrency,
      updatedAt: control.updatedAt.toISOString(),
      overallHealth,
    },
    workers: workers.map((worker) => ({
      workerId: worker.workerId,
      host: worker.host,
      version: worker.version,
      state: now.getTime() - worker.lastHeartbeatAt.getTime() > WORKER_STALE_MS ? 'UNKNOWN' : worker.state,
      startedAt: worker.startedAt.toISOString(),
      lastHeartbeatAt: worker.lastHeartbeatAt.toISOString(),
      currentWork: worker.currentWork,
    })),
    agents,
    queue: {
      queued: counts.get('QUEUED') ?? 0,
      claimed: counts.get('CLAIMED') ?? 0,
      running: counts.get('RUNNING') ?? 0,
      needsReview: reviewCaseCount,
      blocked: counts.get('BLOCKED') ?? 0,
      failedRetryable: counts.get('FAILED_RETRYABLE') ?? 0,
      failedFinal: counts.get('FAILED_FINAL') ?? 0,
      oldestQueuedAt: oldestQueued?.availableAt.toISOString() ?? null,
    },
    summary: {
      workingNow: (counts.get('CLAIMED') ?? 0) + (counts.get('RUNNING') ?? 0),
      inQueue: counts.get('QUEUED') ?? 0,
      blocked: (counts.get('BLOCKED') ?? 0) + (counts.get('FAILED_RETRYABLE') ?? 0) + (counts.get('FAILED_FINAL') ?? 0),
      solvedToday: completedToday,
      discoveredToday: null,
      approvals: reviewCaseCount,
    },
    workItems: workItemRows,
    schedules: schedules.map((schedule) => ({
      id: schedule.id,
      agentId: schedule.agentId,
      scheduleKey: schedule.scheduleKey,
      enabled: schedule.enabled,
      nextRunAt: schedule.nextRunAt?.toISOString() ?? null,
      lastRunAt: schedule.lastRunAt?.toISOString() ?? null,
    })),
    usage: {
      dailyTokens: usageByAgentModel.reduce((total, row) => total + row.dailyTokens, 0),
      dailyCostUsd: usageByAgentModel.reduce((total, row) => total + row.dailyCostUsd, 0),
      monthlyTokens: usageByAgentModel.reduce((total, row) => total + row.monthlyTokens, 0),
      monthlyCostUsd: usageByAgentModel.reduce((total, row) => total + row.monthlyCostUsd, 0),
      byAgentModel: usageByAgentModel,
    },
    incidents: incidents.map((incident) => ({
      id: incident.id,
      type: incident.type,
      severity: incident.severity,
      status: incident.status,
      summary: incident.summary,
      createdAt: incident.createdAt.toISOString(),
      lastSeenAt: incident.lastSeenAt.toISOString(),
    })),
    dependencies,
    messages: messages.map((message) => ({
      id: message.id,
      fromAgentId: message.fromAgentId,
      toAgentId: message.toAgentId,
      messageType: message.messageType,
      status: message.deliveryStatus,
      summary: cleanText(message.content, 280),
      content: cleanText(message.content, 1_000),
      createdAt: message.createdAt.toISOString(),
    })),
  };
}

export function validateRuntimeControlIdempotencyKey(raw: string) {
  // Opaque identifiers must remain byte-for-byte stable. Content redaction can
  // mistake numeric UUID segments for phone numbers and break valid UI keys.
  const key = raw.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,159}$/.test(key)) throw new Error('idempotencyKey inválido');
  return key;
}

export async function applyCompanyOsRuntimeControl(input: {
  action: 'PAUSE' | 'RESUME' | 'RETRY_CASE';
  requestId?: string;
  idempotencyKey: string;
  actorRef: string;
}) {
  const key = validateRuntimeControlIdempotencyKey(input.idempotencyKey);
  const normalizedRequestId = input.requestId?.trim() || null;
  const requestHash = hash(JSON.stringify({ action: input.action, requestId: normalizedRequestId }));
  const db = companyOsV3Prisma();
  return db.$transaction(async (tx) => {
    const auditKey = `audit:runtime-control:${key}`;
    const prior = await tx.companyOsAuditEvent.findUnique({ where: { idempotencyKey: auditKey } });
    if (prior) {
      const metadata = prior.metadata && typeof prior.metadata === 'object' && !Array.isArray(prior.metadata)
        ? prior.metadata as Record<string, unknown>
        : {};
      if (metadata.requestHash !== requestHash) throw new Error('idempotencyKey reutilizada con otro control o caso');
      return { reused: true, action: input.action, requestId: normalizedRequestId };
    }
    if (input.action === 'PAUSE' || input.action === 'RESUME') {
      const paused = input.action === 'PAUSE';
      await tx.companyOsRuntimeControl.update({ where: { id: 'primary' }, data: { paused, updatedBy: input.actorRef } });
      await tx.companyOsAuditEvent.create({ data: {
        requestId: 'runtime-control',
        action: input.action === 'PAUSE' ? 'RUNTIME_PAUSED' : 'RUNTIME_RESUMED',
        actorRef: input.actorRef,
        metadata: jsonValue({ requestHash, paused, businessWrites: 0, infrastructureWrites: 0 }),
        idempotencyKey: auditKey,
      } });
      return { reused: false, action: input.action, paused };
    }
    const requestId = normalizedRequestId;
    if (!requestId) throw new Error('requestId obligatorio para RETRY_CASE');
    const companyCase = await tx.companyOsCase.findUnique({ where: { requestId } });
    if (!companyCase) throw new Error('Caso inexistente');
    if (!['BLOCKED', 'FAILED_RETRYABLE', 'FAILED_FINAL'].includes(companyCase.status)) throw new Error('El estado actual no admite reintento humano');
    const retryableItems = await tx.companyOsWorkItem.findMany({ where: {
      caseId: companyCase.id,
      status: { in: ['BLOCKED', 'FAILED_RETRYABLE', 'FAILED_FINAL'] },
    } });
    if (retryableItems.length === 0) throw new Error('No hay work items reintentables');
    for (const workItem of retryableItems) await tx.companyOsWorkItem.update({ where: { id: workItem.id }, data: {
      status: 'QUEUED', nextAttemptAt: null, availableAt: new Date(),
    } });
    await tx.companyOsCase.update({ where: { id: companyCase.id }, data: { status: 'QUEUED', nextAttemptAt: null } });
    await appendRuntimeEvent(tx, {
      caseId: companyCase.id,
      requestId: companyCase.requestId,
      eventType: 'HUMAN_RETRY_REQUESTED',
      fromStatus: companyCase.status,
      toStatus: 'QUEUED',
      payload: { workItemIds: retryableItems.map((item) => item.id), actorRef: input.actorRef },
      idempotencyKey: `runtime:${companyCase.requestId}:human-retry:${key}`,
    });
    await tx.companyOsAuditEvent.create({ data: {
      requestId: companyCase.requestId,
      action: 'HUMAN_RETRY_REQUESTED',
      actorRef: input.actorRef,
      metadata: jsonValue({ requestHash, workItemCount: retryableItems.length, businessWrites: 0, infrastructureWrites: 0 }),
      idempotencyKey: auditKey,
    } });
    return { reused: false, action: input.action, requestId, queued: retryableItems.length };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
