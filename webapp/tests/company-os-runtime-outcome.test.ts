import assert from 'node:assert/strict';
import test from 'node:test';
import { planRequiredRuntimeReview, runtimeResultNeedsReview } from '../lib/company-os/runtime-outcome';
import { findCompletedRuntimeDelegation, runtimeFollowUpCapacity } from '../lib/company-os/runtime-delegation';
import { completeCompanyOsRuntimeWork } from '../lib/company-os/runtime-store';

const analysis = {
  output: { confidence: 0.9, needsHumanDecision: false, missions: [{ status: 'PLANNED', title: 'Revisar cobertura' }] },
  agentId: 'general-manager-ai-v3', canContinue: true, minConfidence: 0.75,
};

const general = 'general-manager-ai-v3';
const specialist = 'data-manager-ai-v1';
const reviewInput = () => ({
  caseType: 'CONTINUOUS_OBJECTIVE', context: { recommendedSpecialist: specialist },
  installedAgentIds: [general, specialist, 'systems-manager-ai-v1'],
  minimumConfidenceByAgent: { [specialist]: 0.75 },
  currentWork: { id: 'general-integration', agentId: general, causalMessageId: 'specialist-result' },
  attemptStartedAt: new Date('2026-09-06T12:02:00Z'),
  output: { confidence: 0.95, needsHumanDecision: false, delegations: [], evidenceRefs: ['quality'] },
  works: [{ id: 'review-work', agentId: specialist, status: 'COMPLETED', causalMessageId: 'delegation', attempts: [{ outcome: 'SUCCEEDED' }] }],
  messages: [
    { id: 'delegation', fromAgentId: general, toAgentId: specialist, messageType: 'DELEGATION',
      deliveryStatus: 'DELIVERED', causationId: 'first-manager-result', deliveredAt: new Date('2026-09-06T12:00:00Z'), evidenceRefs: ['quality'], payload: {} },
    { id: 'specialist-result', fromAgentId: specialist, toAgentId: general, messageType: 'SPECIALIST_RESULT',
      deliveryStatus: 'DELIVERED', causationId: 'delegation', deliveredAt: new Date('2026-09-06T12:01:00Z'), evidenceRefs: ['quality'], payload: { confidence: 0.95, needsHumanDecision: false } },
  ],
});

test('continuous closure requires a delivered successful specialist review and subsequent causal integration', () => {
  const plan = planRequiredRuntimeReview(reviewInput());
  assert.equal(plan.satisfied, true);
  assert.equal(plan.resultMessageId, 'specialist-result');
  assert.equal(plan.action, 'NONE');
});

test('omitted mandatory review schedules exact specialist instead of accepting empty delegations', () => {
  const plan = planRequiredRuntimeReview({ ...reviewInput(), works: [], messages: [] });
  assert.equal(plan.satisfied, false);
  assert.equal(plan.action, 'DELEGATE');
  assert.equal(plan.requiredSpecialist, specialist);
});

test('delivered review schedules integration only, including missing citations or noncausal results', () => {
  const input = reviewInput();
  assert.equal(planRequiredRuntimeReview({ ...input, currentWork: { ...input.currentWork, causalMessageId: 'another-result' } }).action, 'INTEGRATE');
  assert.equal(planRequiredRuntimeReview({ ...input, output: { ...input.output, evidenceRefs: [] } }).action, 'INTEGRATE');
  assert.equal(planRequiredRuntimeReview({ ...input, attemptStartedAt: new Date('2026-09-06T12:00:00Z') }).action, 'INTEGRATE');
});

test('pending specialist or integration is reused without scheduling another review', () => {
  const input = reviewInput();
  assert.equal(planRequiredRuntimeReview({ ...input, messages: [], works: [{ ...input.works[0], status: 'QUEUED' }] }).action, 'WAIT');
  const pendingIntegration = { id: 'pending-general', agentId: general, status: 'QUEUED', causalMessageId: 'specialist-result', attempts: [] };
  assert.equal(planRequiredRuntimeReview({ ...input, output: { ...input.output, evidenceRefs: [] }, works: [...input.works, pendingIntegration] }).action, 'WAIT');
});

test('wrong specialist, failed attempt, missing delegation or undelivered result never prove review', () => {
  const input = reviewInput();
  for (const changes of [
    { messages: [{ ...input.messages[0], toAgentId: 'systems-manager-ai-v1' }, input.messages[1]] },
    { messages: [input.messages[1]] },
    { messages: [input.messages[0], { ...input.messages[1], fromAgentId: 'systems-manager-ai-v1' }] },
    { messages: [input.messages[0], { ...input.messages[1], deliveryStatus: 'PENDING' }] },
    { messages: [input.messages[0], { ...input.messages[1], payload: { confidence: 0.95, needsHumanDecision: true } }] },
    { messages: [input.messages[0], { ...input.messages[1], payload: { confidence: 0.5, needsHumanDecision: false } }] },
    { messages: [input.messages[0], { ...input.messages[1], payload: { confidence: 1.1, needsHumanDecision: false } }] },
    { messages: [input.messages[0], { ...input.messages[1], evidenceRefs: [] }] },
    { works: [{ ...input.works[0], status: 'FAILED_FINAL' }] },
    { works: [{ ...input.works[0], attempts: [{ outcome: 'FAILED' }] }] },
  ]) {
    const plan = planRequiredRuntimeReview({ ...input, ...changes });
    assert.equal(plan.satisfied, false);
    assert.equal(plan.action, 'REVIEW');
  }
});

test('advisory cases stay unchanged and invalid continuous context fails closed', () => {
  const input = reviewInput();
  assert.equal(planRequiredRuntimeReview({ ...input, caseType: 'ADVISORY', context: undefined, works: [], messages: [] }).satisfied, true);
  assert.equal(planRequiredRuntimeReview({ ...input, context: { recommendedSpecialist: null } }).satisfied, true);
  for (const context of [undefined, {}, { recommendedSpecialist: 'unknown' }, { recommendedSpecialist: general }]) {
    assert.equal(planRequiredRuntimeReview({ ...input, context }).satisfied, false);
    assert.equal(planRequiredRuntimeReview({ ...input, context }).action, 'REVIEW');
  }
});

// Runs the real completion transaction with in-memory persistence. It makes no
// database requests and does not claim to simulate PostgreSQL lock semantics.
async function completeReview(options: { delivered?: boolean; integration?: boolean; maxTurns?: number;
  caseType?: string; missingCitations?: boolean; pendingReview?: boolean; failedReview?: boolean } = {}) {
  const fixture = reviewInput();
  const current = { ...fixture.currentWork, caseId: 'case', status: 'RUNNING', reservedTokens: 12_000,
    causalMessageId: options.integration ? 'specialist-result' : null, priority: 50, attemptCount: 1 };
  const works: Array<Record<string, unknown>> = [current, ...(options.delivered ? fixture.works : [])];
  if (options.pendingReview || options.failedReview) works.push({ ...fixture.works[0],
    status: options.pendingReview ? 'QUEUED' : 'FAILED_FINAL', attempts: [] });
  const messages: Array<Record<string, unknown>> = options.delivered ? [...fixture.messages] : [];
  const companyCase = { id: 'case', requestId: 'request', status: 'RUNNING', caseType: options.caseType ?? 'CONTINUOUS_OBJECTIVE',
    objective: 'Verificar unidad', turnCount: 0, maxTurns: options.maxTurns ?? 6, targetTotalTokens: 12_000 };
  const leases: Array<Record<string, unknown>> = [];
  const events: Array<Record<string, unknown>> = [];
  const tx = {
    $queryRaw: async () => [],
    companyOsCase: { findUniqueOrThrow: async () => companyCase,
      update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(companyCase, data) },
    companyOsWorkItem: {
      findUnique: async () => current,
      findMany: async ({ where }: { where: { status?: string } }) => works.filter((work) => !where.status || work.status === where.status),
      count: async ({ where }: { where: { id: { not: string }; status: { in: string[] } } }) =>
        works.filter((work) => work.id !== where.id.not && where.status.in.includes(String(work.status))).length,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(works.find((work) => work.id === where.id)!, data),
      upsert: async ({ create }: { create: Record<string, unknown> }) => {
        const prior = works.find((work) => work.idempotencyKey === create.idempotencyKey);
        if (prior) return prior;
        const added = { ...create, status: 'QUEUED', attempts: [] }; works.push(added); return added;
      },
    },
    companyOsMessage: {
      findUnique: async ({ where }: { where: { idempotencyKey?: string; id?: string } }) =>
        messages.find((message) => where.id ? message.id === where.id : message.idempotencyKey === where.idempotencyKey) ?? null,
      findMany: async () => messages,
      create: async ({ data }: { data: Record<string, unknown> }) => { const added = { id: `message-${messages.length}`, ...data }; messages.push(added); return added; },
    },
    companyOsEvidenceRef: { findMany: async () => [
      { evidenceKey: 'continuousObjective', value: fixture.context, createdAt: new Date(0) },
      { evidenceKey: 'quality', value: {}, createdAt: new Date(0) },
    ] },
    companyOsLease: { findFirst: async () => ({ id: 'lease', reservedTokens: 12_000, slotNo: null }),
      update: async ({ data }: { data: Record<string, unknown> }) => { leases.push(data); return data; } },
    companyOsExecutionAttempt: { findFirstOrThrow: async () => ({ id: 'attempt', startedAt: fixture.attemptStartedAt }), update: async () => ({}) },
    companyOsUsage: { findUnique: async () => ({ alertLevel: 'NORMAL' }) },
    companyOsCaseEvent: { findUnique: async () => null, findFirst: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => { events.push(data); return data; } },
    companyOsAuditEvent: { findUnique: async () => null, create: async () => ({}) },
  };
  const globalDb = globalThis as unknown as { companyOsV3Prisma?: unknown };
  const previous = globalDb.companyOsV3Prisma;
  globalDb.companyOsV3Prisma = { $transaction: async (run: (arg: typeof tx) => Promise<unknown>) => run(tx) };
  try {
    const result = await completeCompanyOsRuntimeWork({ workItemId: current.id, requestId: 'request', leaseToken: 'lease', workerId: 'test', instanceId: 'test',
      output: { summary: 'Análisis completo.', primaryDataQualityProblem: 'Cobertura revisada.',
        evidenceRefs: options.missingCitations ? [] : ['quality'], recommendedNextStep: 'Observar la fuente.',
        missions: [], delegations: [], needsHumanDecision: false, confidence: 0.95 },
      usage: { provider: 'ollama', model: 'test-local', inputTokens: 100, outputTokens: 100, totalTokens: 200,
        cachedTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, durationMs: 10, retries: 0, snapshotBytes: 0, rulesApplied: [] },
    });
    return { result, works, messages, companyCase, leases, events };
  } finally { globalDb.companyOsV3Prisma = previous; }
}

test('real completion repairs omitted review and waits for specialist without duplicate work', async () => {
  const missing = await completeReview();
  assert.equal(missing.result.status, 'RUNNING');
  assert.equal(missing.works.filter((work) => work.agentId === specialist).length, 1);
  assert.equal(missing.leases[0].status, 'COMPLETED');
  const pending = await completeReview({ pendingReview: true });
  assert.equal(pending.result.status, 'RUNNING');
  assert.equal(pending.works.filter((work) => work.agentId === specialist).length, 1);
});

test('real completion integrates delivered review and only closes after causal citation', async () => {
  const repair = await completeReview({ delivered: true });
  assert.equal(repair.result.status, 'RUNNING');
  assert.equal(repair.works.filter((work) => work.agentId === specialist).length, 1);
  assert.equal(repair.works.filter((work) => work.status === 'QUEUED')[0].causalMessageId, 'specialist-result');
  assert.equal((await completeReview({ delivered: true, integration: true })).result.status, 'COMPLETED');
  assert.equal((await completeReview({ delivered: true, integration: true, missingCitations: true })).result.status, 'RUNNING');
});

test('real completion cannot close missing or failed review with exhausted turns; advisory remains completable', async () => {
  assert.equal((await completeReview({ maxTurns: 1 })).result.status, 'NEEDS_REVIEW');
  assert.equal((await completeReview({ failedReview: true })).result.status, 'NEEDS_REVIEW');
  assert.equal((await completeReview({ delivered: true, maxTurns: 1 })).result.status, 'NEEDS_REVIEW');
  assert.equal((await completeReview({ caseType: 'ADVISORY' })).result.status, 'COMPLETED');
});

test('el análisis con propuestas PLANNED termina sin aprobación rutinaria', () => {
  assert.equal(runtimeResultNeedsReview(analysis), false);
  assert.equal(analysis.output.missions[0].status, 'PLANNED');
});

test('conserva revisión para decisión explícita, evidencia insuficiente y confianza inválida', () => {
  assert.equal(runtimeResultNeedsReview({ ...analysis, output: { ...analysis.output, needsHumanDecision: true } }), true);
  assert.equal(runtimeResultNeedsReview({ ...analysis, output: { ...analysis.output, confidence: 0.74 } }), true);
  assert.equal(runtimeResultNeedsReview({ ...analysis, output: { ...analysis.output, confidence: undefined } }), true);
});

test('no declara cierre cuando se agotaron turnos y falta integrar o delegar', () => {
  assert.equal(runtimeResultNeedsReview({ ...analysis, canContinue: false, agentId: 'data-manager-ai-v1' }), true);
  assert.equal(runtimeResultNeedsReview({ ...analysis, canContinue: false, output: { ...analysis.output, delegations: [{}] } }), true);
  assert.equal(runtimeResultNeedsReview({ ...analysis, canContinue: false }), false);
});

test('suprime repetir objetivo Data ya completado con la misma evidencia o un subconjunto', () => {
  const completed = [{ workItemId: 'initial-data-completed', agentId: 'data-manager-ai-v1',
    objective: 'Actualizá la calidad y frescura.', evidenceRefs: ['metrics', 'quality', 'freshness'] }];
  const repeated = { agentId: 'data-manager-ai-v1', objective: '  ACTUALIZÁ la calidad  y frescura. ', evidenceRefs: ['quality', 'metrics'] };
  assert.equal(findCompletedRuntimeDelegation(repeated, completed)?.workItemId, 'initial-data-completed');
  assert.equal(findCompletedRuntimeDelegation({ ...repeated, evidenceRefs: ['freshness', 'metrics', 'quality'] }, completed)?.workItemId, 'initial-data-completed');
  assert.equal(completed[0].workItemId, 'initial-data-completed');
  assert.equal(completed[0].evidenceRefs.length, 3);
});

test('permite objetivo distinto, especialista diferente o evidencia nueva', () => {
  const task = { agentId: 'data-manager-ai-v1', objective: 'Verificar consistencia de stock', evidenceRefs: ['metrics'] };
  const completed = [{ ...task, workItemId: 'data-done' }];
  assert.equal(findCompletedRuntimeDelegation({ ...task, objective: 'Verificar frescura del catálogo' }, completed), null);
  assert.equal(findCompletedRuntimeDelegation({ ...task, agentId: 'systems-manager-ai-v1' }, completed), null);
  assert.equal(findCompletedRuntimeDelegation({ ...task, evidenceRefs: ['metrics', 'new-observation'] }, completed), null);
  assert.equal(findCompletedRuntimeDelegation(task, []), null);
});

test('reserva el último turno para integrar General y no promete respuesta sin receptor', () => {
  assert.deepEqual(runtimeFollowUpCapacity(4, 6), { canReturnToGeneral: true, canDelegateToSpecialist: true });
  assert.deepEqual(runtimeFollowUpCapacity(5, 6), { canReturnToGeneral: true, canDelegateToSpecialist: false });
  assert.deepEqual(runtimeFollowUpCapacity(6, 6), { canReturnToGeneral: false, canDelegateToSpecialist: false });
  assert.deepEqual(runtimeFollowUpCapacity(4, 6, 1), { canReturnToGeneral: true, canDelegateToSpecialist: false });
  // A consumed duplicate is not an outstanding delegation; the original result stays immutable.
  const output = { ...analysis.output, delegations: [{ agentId: 'data-manager-ai-v1' }] };
  assert.equal(runtimeResultNeedsReview({ ...analysis, canContinue: false, output: { ...output, delegations: [] } }), false);
  assert.equal(output.delegations.length, 1);
});
