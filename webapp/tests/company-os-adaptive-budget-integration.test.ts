import assert from 'node:assert/strict';
import test from 'node:test';
import type { Prisma } from '@prisma/client';
import { claimCompanyOsRuntimeWork, completeCompanyOsRuntimeWork, reconsiderLocalObjectiveBudget } from '../lib/company-os/runtime-store';
import { getCompanyOsRuntimeContract } from '../lib/company-os/runtime-contracts';

// Executes the real claim orchestration against a transaction double. It does
// not simulate PostgreSQL locking/filter semantics or make database requests.
async function claimWith(options: {
  caseType?: string; used?: number; paused?: boolean; objectiveActive?: boolean;
  evidence?: unknown; loseWorkRace?: boolean; allowlist?: string | null; goalIncluded?: boolean;
  specialistReturn?: boolean; contextMessages?: Array<Record<string, unknown>>;
  causalKind?: string; causalDeliveryStatus?: string;
  causalMessageType?: string; causalFromAgentId?: string; causalToAgentId?: string;
} = {}) {
  const globalDb = globalThis as unknown as { companyOsV3Prisma?: unknown };
  const previous = globalDb.companyOsV3Prisma;
  const previousAllowlist = process.env.COMPANY_OS_ADAPTIVE_LOCAL_GOAL_IDS;
  const configuredAllowlist = options.allowlist === undefined ? '565970b3-6e88-4226-8c2a-146e34d6633b' : options.allowlist;
  if (configuredAllowlist === null) delete process.env.COMPANY_OS_ADAPTIVE_LOCAL_GOAL_IDS;
  else process.env.COMPANY_OS_ADAPTIVE_LOCAL_GOAL_IDS = configuredAllowlist;
  const contract = getCompanyOsRuntimeContract('general-manager-ai-v3');
  const candidate = {
    workItemId: 'work-test', caseId: 'case-test', requestId: 'request-test', agentId: contract.agentId,
    objective: 'Analizar evidencia local', workObjective: null, caseStatus: 'QUEUED',
    caseType: options.caseType ?? 'CONTINUOUS_OBJECTIVE', maxOutputTokens: 3_000,
    targetTotalTokens: 12_000, turnCount: 0, maxTurns: 6, workStatus: 'QUEUED',
    attemptCount: 0, maxAttempts: 3, timeoutMs: 120_000, reservedTokens: 12_000,
    contractVersion: contract.version, handlerKey: contract.handlerKey, contract,
    causalMessageType: options.specialistReturn ? (options.causalMessageType ?? 'SPECIALIST_RESULT') : null,
    causalKind: options.specialistReturn ? (options.causalKind ?? 'RESULT') : null,
    causalFromAgentId: options.specialistReturn ? (options.causalFromAgentId ?? 'systems-manager-ai-v1') : null,
    causalToAgentId: options.specialistReturn ? (options.causalToAgentId ?? 'general-manager-ai-v3') : null,
    causalDeliveryStatus: options.specialistReturn ? (options.causalDeliveryStatus ?? 'DELIVERED') : null,
  };
  const leases: Record<string, unknown>[] = [];
  const workUpdates: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];
  const allowlistQueries: unknown[][] = [];
  let candidateReads = 0;
  const tx = {
    async $queryRaw(query: Prisma.Sql) {
      if (query.sql.includes('SELECT id, "caseId", "requestId", "leaseToken"')) return [];
      if (query.sql.includes('FROM public."CompanyOsRuntimeSlot"')) return [{ slotNo: 1 }];
      if (query.sql.includes('FROM public."CompanyOsWorkItem" work')) {
        candidateReads++;
        return options.loseWorkRace && candidateReads > 1 ? [] : [candidate];
      }
      if (query.sql.includes('FOR SHARE OF objective')) return candidate.caseType !== 'CONTINUOUS_OBJECTIVE' ? [] : [{
        status: options.objectiveActive === false ? 'PAUSED' : 'ACTIVE',
        startsAt: new Date(0), endsAt: new Date('2100-01-01'), checkedAt: new Date(),
      }];
      if (query.sql.includes('FROM public."CompanyOsUsage"')) return [{ totalTokens: options.used ?? 37_582, estimatedCostUsd: 0 }];
      if (query.sql.includes('SELECT true AS enabled FROM public."CompanyOsObjectiveUnit"')) {
        allowlistQueries.push(query.values);
        return options.goalIncluded === false ? [] : [{ enabled: true }];
      }
      assert.fail(`Unexpected SQL in claim transaction: ${query.sql}`);
    },
    companyOsRuntimeControl: { findUniqueOrThrow: async () => ({ paused: options.paused ?? false, globalConcurrency: 2, leaseMs: 60_000 }) },
    companyOsLease: {
      aggregate: async () => ({ _sum: { reservedTokens: 0 } }),
      create: async ({ data }: { data: Record<string, unknown> }) => { leases.push(data); return { id: 'lease-test', ...data }; },
    },
    companyOsCase: { findUniqueOrThrow: async () => candidate, update: async () => ({}) },
    companyOsWorkItem: {
      findFirst: async () => null,
      update: async ({ data }: { data: Record<string, unknown> }) => { workUpdates.push(data); return {}; },
    },
    companyOsMessage: { findFirst: async () => null, findMany: async () => options.contextMessages ?? [] },
    companyOsEvidenceRef: { findMany: async () => options.evidence ? [{ evidenceKey: 'snapshot', value: options.evidence }] : [] },
    companyOsExecutionAttempt: { count: async () => 0, create: async () => ({ id: 'attempt-test' }) },
    companyOsRuntimeSlot: { update: async () => ({}) },
    companyOsHeartbeat: { create: async () => ({}) },
    companyOsCaseEvent: {
      findUnique: async () => null, findFirst: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => { events.push(data); return data; },
    },
  };
  globalDb.companyOsV3Prisma = {
    $transaction: async (run: (arg: typeof tx) => Promise<unknown>, config: { isolationLevel: string }) => {
      assert.equal(config.isolationLevel, 'Serializable');
      return run(tx);
    },
  };
  try {
    const claim = await claimCompanyOsRuntimeWork({ workerId: 'worker-test', instanceId: 'instance-test' });
    return { claim, leases, workUpdates, events, allowlistQueries };
  } finally {
    globalDb.companyOsV3Prisma = previous;
    if (previousAllowlist === undefined) delete process.env.COMPANY_OS_ADAPTIVE_LOCAL_GOAL_IDS;
    else process.env.COMPANY_OS_ADAPTIVE_LOCAL_GOAL_IDS = previousAllowlist;
  }
}

test('real claim persists reduced lease, returns identical worker allowance and audits adaptation', async () => {
  const result = await claimWith();
  assert.ok(result.claim);
  assert.equal(result.claim.budgets.input, 9_000);
  assert.equal(result.claim.budgets.maxOutputTokens, 1_418);
  assert.equal(result.claim.budgets.targetTotalTokens, 10_418);
  assert.equal(result.leases.length, 1);
  assert.equal(result.leases[0].reservedTokens, 10_418);
  const event = result.events.find((event) => event.eventType === 'RUNTIME_WORK_CLAIMED');
  const budget = (event?.payload as { budget: Record<string, unknown> }).budget;
  assert.equal(budget.adapted, true);
  assert.equal(budget.originalReservation, 12_000);
  assert.equal(budget.reservedTokens, result.leases[0].reservedTokens);
  assert.equal(result.claim.businessWritesAuthorized, 0);
  assert.equal(result.claim.advisoryOnly, true);
  assert.deepEqual(result.allowlistQueries, [['case-test', '565970b3-6e88-4226-8c2a-146e34d6633b']]);
});

test('specialist return uses compact local context and the exact remaining daily allowance', async () => {
  const manager = { id: 'manager', role: 'assistant', kind: 'RESULT', messageType: 'MANAGER_RESULT',
    fromAgentId: 'general-manager-ai-v3', toAgentId: null, content: 'x'.repeat(4_000), payload: {}, createdAt: new Date(1) };
  const specialist = { id: 'specialist', role: 'assistant', kind: 'RESULT', messageType: 'SPECIALIST_RESULT',
    fromAgentId: 'systems-manager-ai-v1', toAgentId: 'general-manager-ai-v3', content: 'hallazgo', payload: {}, createdAt: new Date(2) };
  const result = await claimWith({ used: 42_005, specialistReturn: true, contextMessages: [specialist, manager] });
  assert.ok(result.claim);
  assert.equal(result.claim.budgets.input, 5_000);
  assert.equal(result.claim.budgets.maxOutputTokens, 995);
  assert.equal(result.claim.budgets.targetTotalTokens, 5_995);
  assert.deepEqual(result.claim.contextMessages.map((message: { id: string }) => message.id), ['specialist']);
  assert.equal(result.leases[0].reservedTokens, 5_995);
});

test('compact budget rejects a causal row that is not a delivered result', async () => {
  for (const options of [
    { causalKind: 'CONTEXT' },
    { causalDeliveryStatus: 'PENDING' },
    { causalMessageType: 'MANAGER_RESULT' },
    { causalFromAgentId: 'general-manager-ai-v3' },
    { causalToAgentId: 'systems-manager-ai-v1' },
  ]) {
    const result = await claimWith({ used: 42_005, specialistReturn: true, ...options });
    assert.equal(result.claim, null);
    assert.equal(result.leases.length, 0);
    assert.equal(result.events[0].eventType, 'WORK_DEFERRED_RUNTIME_BUDGET');
  }
});

test('reconsideration advances only an authentic delivered specialist return', async () => {
  const previousAllowlist = process.env.COMPANY_OS_ADAPTIVE_LOCAL_GOAL_IDS;
  process.env.COMPANY_OS_ADAPTIVE_LOCAL_GOAL_IDS = '565970b3-6e88-4226-8c2a-146e34d6633b';
  const now = new Date('2026-09-03T17:00:00Z');
  const updates: Array<Record<string, unknown>> = [];
  const events: Array<Record<string, unknown>> = [];
  const row = {
    workItemId: 'return-work', caseId: 'case-test', requestId: 'request-test',
    agentId: 'general-manager-ai-v3', reservedTokens: 12_000, targetTotalTokens: 12_000,
    maxOutputTokens: 3_000, availableAt: new Date('2026-09-04T04:00:00Z'),
    caseStatus: 'RUNNING', budgetEventId: 'budget-event', causalKind: 'RESULT',
    causalMessageType: 'SPECIALIST_RESULT', causalFromAgentId: 'systems-manager-ai-v1',
    causalToAgentId: 'general-manager-ai-v3', causalDeliveryStatus: 'DELIVERED',
  };
  const tx = {
    async $queryRaw(query: Prisma.Sql) {
      if (query.sql.includes('FROM public."CompanyOsWorkItem" work')) return [row];
      if (query.sql.includes('FROM public."CompanyOsUsage"')) return [{ totalTokens: 42_005, estimatedCostUsd: 0 }];
      assert.fail(`Unexpected SQL in reconsider transaction: ${query.sql}`);
    },
    companyOsLease: { aggregate: async () => ({ _sum: { reservedTokens: 0 } }) },
    companyOsWorkItem: { update: async ({ data }: { data: Record<string, unknown> }) => { updates.push(data); return {}; } },
    companyOsCaseEvent: {
      findUnique: async () => null,
      findFirst: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => { events.push(data); return data; },
    },
  };
  try {
    assert.equal(await reconsiderLocalObjectiveBudget(tx as never, now), 1);
    assert.equal(updates[0].availableAt, now);
    assert.equal(events[0].eventType, 'WORK_BUDGET_RECONSIDERED');
    row.causalDeliveryStatus = 'PENDING';
    updates.length = 0;
    events.length = 0;
    assert.equal(await reconsiderLocalObjectiveBudget(tx as never, now), 0);
    assert.equal(updates.length, 0);
  } finally {
    if (previousAllowlist === undefined) delete process.env.COMPANY_OS_ADAPTIVE_LOCAL_GOAL_IDS;
    else process.env.COMPANY_OS_ADAPTIVE_LOCAL_GOAL_IDS = previousAllowlist;
  }
});

test('standard case keeps manager context even with a specialist causal message', async () => {
  const manager = { id: 'manager', role: 'assistant', kind: 'RESULT', messageType: 'MANAGER_RESULT',
    fromAgentId: 'general-manager-ai-v3', toAgentId: null, content: 'provisional', payload: {}, createdAt: new Date(1) };
  const result = await claimWith({ caseType: 'ADVISORY', used: 0, specialistReturn: true, contextMessages: [manager] });
  assert.ok(result.claim);
  assert.deepEqual(result.claim.contextMessages.map((message: { id: string }) => message.id), ['manager']);
  assert.equal(result.claim.budgets.targetTotalTokens, 12_000);
});

test('empty or absent rollout flag and a nonmatching objective never shrink the standard reservation', async () => {
  for (const options of [{ allowlist: '' }, { allowlist: null }, { goalIncluded: false }]) {
    const result = await claimWith(options);
    assert.equal(result.claim, null);
    assert.equal(result.leases.length, 0);
    assert.equal(result.events[0].eventType, 'WORK_DEFERRED_RUNTIME_BUDGET');
    if ('allowlist' in options) assert.equal(result.allowlistQueries.length, 0);
  }
  const fullBudget = await claimWith({ used: 0, goalIncluded: false });
  assert.ok(fullBudget.claim);
  assert.equal(fullBudget.claim.budgets.targetTotalTokens, 12_000);
  assert.equal(fullBudget.claim.budgets.maxOutputTokens, 3_000);
  assert.equal(fullBudget.leases[0].reservedTokens, 12_000);
});

test('rollout scope rejects malformed/wildcard values and dedupes only exact goal ids', async () => {
  for (const allowlist of ['*', 'all', '565970b3-6e88-4226-8c2a-146e34d6633b,invalid']) {
    await assert.rejects(claimWith({ allowlist }), /Invalid adaptive local goal allowlist/);
  }
  const result = await claimWith({ allowlist: '565970b3-6e88-4226-8c2a-146e34d6633b,565970b3-6e88-4226-8c2a-146e34d6633b' });
  assert.deepEqual(result.allowlistQueries, [['case-test', '565970b3-6e88-4226-8c2a-146e34d6633b']]);
});

test('standard/cloud cases retain full reservation and defer without a lease', async () => {
  const result = await claimWith({ caseType: 'ADVISORY' });
  assert.equal(result.claim, null);
  assert.equal(result.leases.length, 0);
  assert.equal(result.events[0].eventType, 'WORK_DEFERRED_RUNTIME_BUDGET');
  assert.equal(result.workUpdates[0].status, 'QUEUED');
  assert.ok(result.workUpdates[0].availableAt instanceof Date);
  assert.equal(result.allowlistQueries.length, 0);
});

test('minimum output, full input gate, runtime pause, objective pause and lost race remain closed', async () => {
  for (const options of [
    { used: 38_001 }, { evidence: 'x'.repeat(40_000) }, { paused: true },
    { objectiveActive: false }, { loseWorkRace: true },
  ]) {
    const result = await claimWith(options);
    assert.equal(result.claim, null, JSON.stringify(options).slice(0, 100));
    assert.equal(result.leases.length, 0);
  }
});

test('completion rejects usage above adapted lease even below original work and case limits', async () => {
  const globalDb = globalThis as unknown as { companyOsV3Prisma?: unknown };
  const previous = globalDb.companyOsV3Prisma;
  const tx = {
    companyOsWorkItem: {
      findUnique: async () => ({ id: 'work-test', caseId: 'case-test', agentId: 'general-manager-ai-v3', status: 'CLAIMED', reservedTokens: 12_000 }),
      update: async () => assert.fail('Rejected completion must not advance work'),
    },
    companyOsLease: { findFirst: async () => ({ reservedTokens: 10_418 }) },
    companyOsCase: { findUniqueOrThrow: async () => ({ id: 'case-test', status: 'CLAIMED', targetTotalTokens: 12_000 }) },
    companyOsEvidenceRef: { findMany: async () => [] },
  };
  globalDb.companyOsV3Prisma = { $transaction: async (run: (arg: typeof tx) => Promise<unknown>) => run(tx) };
  try {
    await assert.rejects(completeCompanyOsRuntimeWork({
      workItemId: 'work-test', requestId: 'request-test', leaseToken: 'lease-test', workerId: 'worker-test', instanceId: 'instance-test',
      output: {
        summary: 'Análisis acotado.', primaryDataQualityProblem: 'Cobertura pendiente.',
        evidenceRefs: [], recommendedNextStep: 'Verificar fuente.', missions: [], delegations: [],
        needsHumanDecision: false, confidence: 0.9,
      },
      usage: {
        provider: 'ollama', model: 'test-local', inputTokens: 9_000, outputTokens: 2_000, totalTokens: 11_000,
        cachedTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, durationMs: 10, retries: 0,
        snapshotBytes: 0, rulesApplied: [],
      },
    }), /Consumo total excede el presupuesto reservado/);
  } finally { globalDb.companyOsV3Prisma = previous; }
});
