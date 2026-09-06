import assert from 'node:assert/strict';
import test from 'node:test';
import { accountRuntimeUsage, failCompanyOsRuntimeWork, receiveAndCompleteCompanyOsRuntimeWork, recoverRuntimeResults } from '../lib/company-os/runtime-store';
import { getCompanyOsRuntimeResultStatus, receiveRuntimeResult, requireRuntimeCompletionLease, resultArchiveKey, runtimeResultHash } from '../lib/company-os/runtime-result-receipts';

const input = {
  workItemId: 'work', requestId: 'request', leaseToken: 'synthetic-lease', workerId: 'worker',
  instanceId: 'new-instance', leaseInstanceId: 'original-instance', attemptId: 'attempt',
  output: { summary: 'Resultado sintético', primaryDataQualityProblem: 'Sin cambios', evidenceRefs: ['snapshot'],
    recommendedNextStep: 'Revisar evidencia', missions: [], delegations: [], needsHumanDecision: false, confidence: 0.99 },
  usage: { provider: 'ollama' as const, model: 'synthetic', inputTokens: 100, cachedTokens: 0, cacheWriteTokens: 0,
    outputTokens: 20, reasoningTokens: 0, totalTokens: 120 },
};
type Row = Record<string, any>;

// The real store runs over a rollback-capable transaction double. No DB/network/model calls.
async function harness(run: (h: { tables: () => Record<string, Row[]>; tx: any; failApply: () => void }) => Promise<void>) {
  const globalDb = globalThis as unknown as { companyOsV3Prisma?: unknown };
  const previous = globalDb.companyOsV3Prisma;
  let tables: Record<string, Row[]> = {
    companyOsWorkItem: [{ id: 'work', caseId: 'case', agentId: 'general-manager-ai-v3', status: 'RUNNING', attemptCount: 1, maxAttempts: 3, reservedTokens: 12_000, causalMessageId: null }],
    companyOsCase: [{ id: 'case', requestId: 'request', agentId: 'general-manager-ai-v3', status: 'RUNNING', caseType: 'MANUAL', turnCount: 0, maxTurns: 6, targetTotalTokens: 12_000 }],
    companyOsLease: [{ id: 'lease', caseId: 'case', ...input, output: undefined, usage: undefined,
      instanceId: 'original-instance', reservedTokens: 12_000, status: 'ACTIVE', slotNo: 1, expiresAt: new Date(Date.now() + 300_000) }],
    companyOsExecutionAttempt: [{ id: 'attempt', ...input, output: undefined, usage: undefined, instanceId: 'original-instance',
      caseId: 'case', agentId: 'general-manager-ai-v3', attempt: 1, outcome: 'STARTED', finishedAt: null }],
    companyOsEvidenceRef: [{ id: 'evidence', caseId: 'case', evidenceKey: 'snapshot', value: {}, createdAt: new Date() }],
    companyOsMessage: [], companyOsUsage: [], companyOsAuditEvent: [], companyOsCaseEvent: [], companyOsHeartbeat: [],
    companyOsMission: [], companyOsRuntimeSlot: [{ slotNo: 1, leaseToken: input.leaseToken }],
  };
  function matches(row: Row, where: Row = {}): boolean {
    return Object.entries(where).every(([key, value]) => {
      if (value === undefined) return true;
      if (key === 'OR') return value.some((part: Row) => matches(row, part));
      if (key === 'AND') return value.every((part: Row) => matches(row, part));
      if (key === 'caseId_idempotencyKey') return matches(row, value);
      if (value && typeof value === 'object' && !(value instanceof Date)) {
        if ('in' in value) return value.in.includes(row[key]);
        if ('not' in value) return row[key] !== value.not;
        if ('gt' in value) return row[key] > value.gt;
      }
      return row[key] === value;
    });
  }
  let failApply = false;
  const tx: any = {};
  for (const name of Object.keys(tables)) tx[name] = {
    findUnique: async ({ where }: Row) => tables[name].find((row) => matches(row, where)) ?? null,
    findFirst: async ({ where }: Row = {}) => tables[name].find((row) => matches(row, where)) ?? null,
    findMany: async ({ where }: Row = {}) => tables[name].filter((row) => matches(row, where)),
    count: async ({ where }: Row = {}) => tables[name].filter((row) => matches(row, where)).length,
    findUniqueOrThrow: async ({ where }: Row) => { const row = tables[name].find((r) => matches(r, where)); assert.ok(row, `${name} missing`); return row; },
    findFirstOrThrow: async ({ where }: Row) => { const row = tables[name].find((r) => matches(r, where)); assert.ok(row, `${name} missing`); return row; },
    create: async ({ data }: Row) => {
      if (name === 'companyOsMessage' && failApply) { failApply = false; throw Object.assign(new Error('Synthetic transaction conflict'), { code: 'P2034' }); }
      const row = { id: `${name}:${tables[name].length}`, createdAt: new Date(), ...data }; tables[name].push(row); return row;
    },
    update: async ({ where, data }: Row) => { const row = tables[name].find((r) => matches(r, where)); assert.ok(row, `${name} missing update`); Object.assign(row, data); return row; },
    updateMany: async ({ where, data }: Row) => { const rows = tables[name].filter((r) => matches(r, where)); rows.forEach((r) => Object.assign(r, data)); return { count: rows.length }; },
    createMany: async ({ data }: Row) => { tables[name].push(...data); return { count: data.length }; },
  };
  tx.$queryRaw = async (query: Row) => {
    if (query.sql.includes('SELECT receipt.metadata')) return tables.companyOsAuditEvent
      .filter((r) => r.action === 'RUNTIME_RESULT_RECEIVED'
        && tables.companyOsExecutionAttempt.find((a) => a.id === r.metadata.attemptId)?.outcome !== 'SUCCEEDED'
        && !tables.companyOsAuditEvent.some((a) => a.idempotencyKey === resultArchiveKey(r.metadata.attemptId)))
      .map((r) => ({ metadata: r.metadata }));
    if (query.sql.includes('FOR UPDATE')) return [{ id: 'work' }];
    if (query.sql.includes('CompanyOsUsage')) return [{ totalTokens: BigInt(0), estimatedCostUsd: 0 }];
    assert.fail(`Unexpected query ${query.sql}`);
  };
  globalDb.companyOsV3Prisma = { ...tx, $transaction: async (fn: (tx: any) => Promise<unknown>) => {
    const snapshot = structuredClone(tables);
    try { return await fn(tx); } catch (error) { tables = snapshot; throw error; }
  } };
  try { await run({ tables: () => tables, tx, failApply: () => { failApply = true; } }); }
  finally { globalDb.companyOsV3Prisma = previous; }
}

test('receipt survives apply rollback; restart applies one result/usage without another attempt', async () => harness(async (h) => {
  h.failApply();
  await assert.rejects(receiveAndCompleteCompanyOsRuntimeWork(input), /Synthetic transaction conflict/);
  assert.equal(h.tables().companyOsAuditEvent.filter((r) => r.action === 'RUNTIME_RESULT_RECEIVED').length, 1);
  assert.equal(h.tables().companyOsMessage.length, 0);
  assert.equal((await getCompanyOsRuntimeResultStatus(input)).state, 'RECEIVED');
  assert.equal((await receiveAndCompleteCompanyOsRuntimeWork(input)).state, 'COMPLETED');
  assert.equal((await receiveAndCompleteCompanyOsRuntimeWork(input)).state, 'COMPLETED');
  assert.equal(h.tables().companyOsExecutionAttempt.length, 1);
  assert.equal(h.tables().companyOsMessage.filter((r) => r.kind === 'RESULT').length, 1);
  assert.equal(h.tables().companyOsUsage.length, 1);
  assert.equal(h.tables().companyOsLease[0].status, 'COMPLETED');
  assert.equal(h.tables().companyOsRuntimeSlot[0].leaseToken, null);
}));

test('late result of an expired last attempt completes without incrementing attemptCount', async () => harness(async (h) => {
  Object.assign(h.tables().companyOsLease[0], { status: 'EXPIRED', expiresAt: new Date(0) });
  Object.assign(h.tables().companyOsExecutionAttempt[0], { outcome: 'TIMED_OUT', errorCode: 'LEASE_EXPIRED', finishedAt: new Date() });
  h.tables().companyOsWorkItem[0].status = 'FAILED_FINAL';
  h.tables().companyOsCase[0].status = 'FAILED_FINAL';
  assert.equal((await receiveAndCompleteCompanyOsRuntimeWork(input)).state, 'COMPLETED');
  assert.equal(h.tables().companyOsWorkItem[0].attemptCount, 1);
  assert.equal(h.tables().companyOsExecutionAttempt[0].errorCode, null);
}));

test('server reconciler materializes a receipt after the original worker disappears', async () => harness(async (h) => {
  h.failApply();
  await assert.rejects(receiveAndCompleteCompanyOsRuntimeWork(input));
  assert.equal((await recoverRuntimeResults()).recovered, 1);
  assert.equal((await getCompanyOsRuntimeResultStatus(input)).state, 'COMPLETED');
  assert.equal(h.tables().companyOsExecutionAttempt.length, 1);
}));

test('old worker fail after receiving output cannot destroy pending materialization', async () => harness(async (h) => {
  h.failApply();
  await assert.rejects(receiveAndCompleteCompanyOsRuntimeWork(input));
  const result = await failCompanyOsRuntimeWork({ ...input, instanceId: 'original-instance', errorCode: 'SYNTHETIC_TIMEOUT', detail: 'Synthetic', retryable: true });
  assert.equal(result.status, 'RESULT_RECEIVED');
  assert.equal(h.tables().companyOsWorkItem[0].status, 'RUNNING');
  assert.equal((await recoverRuntimeResults()).recovered, 1);
}));

test('ownership and request matching precede idempotent readback and completion', async () => harness(async () => {
  await receiveAndCompleteCompanyOsRuntimeWork(input);
  for (const invalid of [{ workerId: 'other' }, { leaseInstanceId: 'other' }, { requestId: 'other' }, { attemptId: 'other' }, { workItemId: 'other' }]) {
    await assert.rejects(getCompanyOsRuntimeResultStatus({ ...input, ...invalid }));
    await assert.rejects(receiveAndCompleteCompanyOsRuntimeWork({ ...input, ...invalid }));
  }
}));

test('applied work stays completed when the case awaits review and the completion is replayed', async () => harness(async (h) => {
  const reviewInput = { ...input, output: { ...input.output, needsHumanDecision: true } };
  assert.equal((await receiveAndCompleteCompanyOsRuntimeWork(reviewInput)).state, 'COMPLETED');
  assert.equal(h.tables().companyOsCase[0].status, 'NEEDS_REVIEW');
  assert.equal((await receiveAndCompleteCompanyOsRuntimeWork(reviewInput)).state, 'COMPLETED');
  assert.equal(h.tables().companyOsAuditEvent.filter((r) => r.action === 'RUNTIME_RESULT_ARCHIVED').length, 0);
  assert.equal(h.tables().companyOsExecutionAttempt[0].outcome, 'SUCCEEDED');
}));

test('same attempt rejects a changed output or usage without altering its receipt', async () => harness(async (h) => {
  await receiveRuntimeResult(input, input.output);
  await assert.rejects(receiveRuntimeResult({ ...input, output: { ...input.output, summary: 'Different' } }, input.output), /distinto/);
  await assert.rejects(receiveRuntimeResult({ ...input, usage: { ...input.usage, totalTokens: 130 } }, input.output), /distinto/);
  assert.equal(h.tables().companyOsAuditEvent.length, 1);
}));

test('result superseded by another attempt is archived, accounted and never overwrites successor', async () => harness(async (h) => {
  h.tables().companyOsExecutionAttempt.push({ ...h.tables().companyOsExecutionAttempt[0], id: 'newer', attempt: 2, leaseToken: 'different' });
  const result = await receiveAndCompleteCompanyOsRuntimeWork(input);
  assert.equal(result.state, 'SUPERSEDED');
  assert.equal(h.tables().companyOsWorkItem[0].status, 'RUNNING');
  assert.equal(h.tables().companyOsExecutionAttempt[1].outcome, 'STARTED');
  assert.equal(h.tables().companyOsUsage[0].totalTokens, 120);
}));

test('cancel between receipt and apply terminates replay while retaining result', async () => harness(async (h) => {
  h.failApply();
  await assert.rejects(receiveAndCompleteCompanyOsRuntimeWork(input));
  h.tables().companyOsCase[0].status = 'CANCELLED';
  h.tables().companyOsWorkItem[0].status = 'CANCELLED';
  assert.equal((await receiveAndCompleteCompanyOsRuntimeWork(input)).state, 'SUPERSEDED');
  assert.equal(h.tables().companyOsWorkItem[0].status, 'CANCELLED');
  assert.equal(h.tables().companyOsUsage.length, 1);
  assert.ok(h.tables().companyOsAuditEvent.find((r) => r.action === 'RUNTIME_RESULT_RECEIVED')?.metadata.output);
}));

test('archived receipt cannot materialize again', async () => harness(async (h) => {
  await receiveRuntimeResult(input, input.output);
  h.tables().companyOsAuditEvent.push({ idempotencyKey: resultArchiveKey(input.attemptId) });
  await assert.rejects(requireRuntimeCompletionLease(h.tx, input), /archivado/);
}));

test('blocked case preserves its block and archives an in-flight result instead of retrying forever', async () => harness(async (h) => {
  h.tables().companyOsCase[0].status = 'BLOCKED';
  assert.equal((await receiveAndCompleteCompanyOsRuntimeWork(input)).state, 'SUPERSEDED');
  assert.equal(h.tables().companyOsCase[0].status, 'BLOCKED');
  assert.equal(h.tables().companyOsUsage[0].totalTokens, 120);
  assert.equal(h.tables().companyOsAuditEvent.filter((r) => r.action === 'RUNTIME_RESULT_RECEIVED').length, 1);
}));

test('unknown usage retains the reserved estimate with explicit accounting provenance', () => {
  const usage = accountRuntimeUsage({ ...input.usage, usageKnown: false, totalTokens: 0 }, 12_000);
  assert.equal(usage.totalTokens, 12_000);
  assert.equal(usage.usageKnown, false);
  assert.ok(usage.rulesApplied?.includes('tokens-are-reserved-estimate'));
});

test('fail does not close a case with a queued sibling', async () => harness(async (h) => {
  h.tables().companyOsWorkItem.push({ ...h.tables().companyOsWorkItem[0], id: 'sibling', status: 'QUEUED' });
  await failCompanyOsRuntimeWork({ ...input, instanceId: 'original-instance', errorCode: 'SYNTHETIC', detail: 'Synthetic', retryable: false });
  assert.equal(h.tables().companyOsWorkItem[0].status, 'FAILED_FINAL');
  assert.equal(h.tables().companyOsCase[0].status, 'RUNNING');
  assert.equal(h.tables().companyOsWorkItem[1].status, 'QUEUED');
}));

test('hash is deterministic with nested and numeric object keys', () => {
  assert.equal(runtimeResultHash({ b: 1, a: { '10': true, '2': false } }), runtimeResultHash({ a: { '2': false, '10': true }, b: 1 }));
});
