import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { continuousCaseBudgets, materializeContinuousCaseEvidence } from '../lib/company-os/continuous-case-evidence';
import { continuousBaselineFingerprint } from '../lib/company-os/continuous-objective-runner';
import { baselineObjectiveUnits, observeObjectiveUnit, type ObjectiveEvidence } from '../lib/company-os/continuous-objective-policy';

test('General-led technical cases retain shared evidence without writing a Systems-owned snapshot', () => {
  const store = readFileSync(new URL('../lib/company-os/v3-store.ts', import.meta.url), 'utf8');
  const create = store.slice(store.indexOf('export async function createCompanyOsCase('), store.indexOf('export async function deliverCompanyOsWebhook'));
  assert.match(create, /const systemsManager = agentId === 'systems-manager-ai-v1' \|\| continuous\?\.systemsEvidence === true/);
  assert.match(create, /await tx\.companyOsEvidenceRef\.createMany\(\{ data: refs \}\)/);
  assert.match(create, /if \(agentId === 'systems-manager-ai-v1'\) \{\s+await persistSystemsSnapshot\(/);
  assert.doesNotMatch(create, /if \(systemsManager\) \{\s+await persistSystemsSnapshot\(/);
  const migration = readFileSync(new URL('../../supabase/migrations/20260816175940_systems_manager_ai_v1.sql', import.meta.url), 'utf8');
  assert.match(migration, /FOREIGN KEY \("caseId", "agentId"\)/);
});

test('continuous cases retain scheduler provenance in their durable message and work item', () => {
  const store = readFileSync(new URL('../lib/company-os/v3-store.ts', import.meta.url), 'utf8');
  const create = store.slice(store.indexOf('export async function createCompanyOsCase('), store.indexOf('export async function dispatchCompanyOsWebhook'));
  assert.match(create, /messageType: \(scheduleRunKey \|\| continuous\) \? 'SCHEDULE_ORDER' : 'HUMAN_ORDER'/);
  assert.match(create, /triggerType: \(scheduleRunKey \|\| continuous\) \? 'SCHEDULE' : relatedRequestId \? 'EVENT' : 'MANUAL'/);
});

test('continuous evidence preserves all technical gaps, source dates and negative findings', () => {
  const assets = [
    { assetId: 'worker', healthStatus: 'HEALTHY', observationMode: 'LIVE_OBSERVED', maxSourceUpdatedAt: '2026-09-03T01:00:00Z', warnings: [] },
    { assetId: 'backup', healthStatus: 'UNOBSERVED', observationMode: 'UNOBSERVED', maxSourceUpdatedAt: null, warnings: ['Backup restoration not verified'] },
  ];
  const risks = [{ riskId: 'single-host', priority: 80 }, { riskId: 'unknown-backup', priority: 0 }];
  const evidence = materializeContinuousCaseEvidence({ assets, risks, dependencies: [], generatedAt: '2026-09-03T02:00:00Z' }, true, { sourceResolved: false });
  assert.deepEqual(evidence.assets, assets);
  assert.deepEqual(evidence.risks, risks);
  assert.equal((evidence.evidenceSelection as Record<string, unknown>).sourceTaskResolutionProven, false);
});

test('continuous data evidence preserves quality/freshness but explicitly excludes product-level calibration', () => {
  const snapshot = { metrics: { units: 0 }, quality: { gaps: ['missing coverage'] }, freshness: { units: 'UNKNOWN' }, calibration: { privateCustomers: ['not selected'] } };
  const evidence = materializeContinuousCaseEvidence(snapshot, false, { objective: 'Review coverage' });
  assert.deepEqual(evidence.metrics, snapshot.metrics);
  assert.deepEqual(evidence.quality, snapshot.quality);
  assert.deepEqual(evidence.freshness, snapshot.freshness);
  assert.equal('calibration' in evidence, false);
  assert.match((evidence.evidenceSelection as Record<string, string>).notice, /omitted/);
});

test('continuous work preserves the installed output and reserved ceilings', () => {
  assert.deepEqual(continuousCaseBudgets({}, 'Review', { targetTotalTokens: 12000, maxOutputTokens: 3000 }), {
    targetTotalTokens: 12000, maxOutputTokens: 3000, inputBudget: 9000,
  });
  assert.deepEqual(continuousCaseBudgets({}, 'Review', { targetTotalTokens: 5000, maxOutputTokens: 700 }), {
    targetTotalTokens: 5000, maxOutputTokens: 700, inputBudget: 4300,
  });
});

test('baseline dedupe ignores observation clocks, but reopens when underlying facts change', () => {
  const first = { generatedAt: '2026-09-03T00:00:00Z', quality: { gap: 'STALE', maxDateOrUpdate: '2026-09-01' }, nested: { checkedAt: 'one', state: 'HEALTHY' } };
  const next = { nested: { state: 'HEALTHY', checkedAt: 'two' }, quality: first.quality, generatedAt: '2026-09-03T01:00:00Z' };
  assert.equal(continuousBaselineFingerprint(first), continuousBaselineFingerprint(next));
  assert.notEqual(continuousBaselineFingerprint(first), continuousBaselineFingerprint({ ...next, quality: { gap: 'FRESH', maxDateOrUpdate: '2026-09-03' } }));
  assert.equal(continuousBaselineFingerprint({ ageHours: 1, fresh: true }), continuousBaselineFingerprint({ ageHours: 2, fresh: true }));
  assert.notEqual(continuousBaselineFingerprint({ ageHours: 1, fresh: true }), continuousBaselineFingerprint({ ageHours: 2, fresh: false }));
});

test('continuous evidence still redacts personal text and invalid date fields', () => {
  const evidence = materializeContinuousCaseEvidence({ generatedAt: 'contact diego@example.com', quality: { note: 'diego@example.com' } }, false, {});
  assert.doesNotMatch(JSON.stringify(evidence), /diego@example.com/);
});

function baselineReadback(systems = false) {
  const definition = { objective: 'Observar el snapshot operativo', criteria: ['Revisar el estado observado'], projectAllowlist: ['AGENTE MANAGER'] };
  const planned = baselineObjectiveUnits(definition, [])[systems ? 0 : 1];
  const observedAt = '2026-09-06T01:00:00.000Z';
  const context = { goalId: 'goal-baseline', version: 1, unitId: 'unit-baseline', sourceId: planned.sourceId,
    fingerprint: planned.fingerprint, source: planned.source, criteria: definition.criteria,
    authority: 'READ_ONLY_ANALYSIS', sourceResolved: false };
  const snapshot = { snapshotId: 'snapshot-baseline', generatedAt: observedAt,
    assets: [{ assetId: 'runtime', healthStatus: 'UNOBSERVED', warnings: ['No heartbeat'] }], dependencies: [], risks: [],
    metrics: { orders: 12 }, quality: { gaps: ['MISSING_SOURCE_DATE'] }, freshness: { latestOrderUpdate: null } };
  const payload = materializeContinuousCaseEvidence(snapshot, systems, context);
  const evidence: ObjectiveEvidence[] = Object.entries(payload).map(([evidenceKey, value]) => ({
    id: `ref-${evidenceKey}`, evidenceKey, value, observedAt, sourceRef: `company-os-snapshot:${snapshot.snapshotId}#${evidenceKey}`,
  }));
  return { caseStatus: 'COMPLETED', hasPendingWork: false, resultMessageId: 'result-general', confidence: 0.9,
    needsHumanDecision: false, resultSummary: 'Se observó el snapshot con sus faltantes.', evidence,
    citedEvidenceKeys: systems ? ['assets', 'dependencies', 'risks'] : ['metrics', 'quality', 'freshness'],
    ...context, goalVersion: context.version, sourceKind: planned.source.kind, resultCreatedAt: '2026-09-06T01:05:00.000Z' };
}

test('verifica readback propio Data y Systems con evidencia materializada, citada y fresca; no certifica salud ni criterios de negocio', () => {
  for (const systems of [false, true]) {
    const input = baselineReadback(systems);
    const result = observeObjectiveUnit(input)!;
    assert.equal(result.status, 'VERIFIED');
    assert.match(result.resultSummary, /criterios empresariales no evaluados/);
    assert.match(result.resultSummary, /No certifica la ejecución de la tarea fuente/);
    assert.ok(result.resultEvidence.includes(`criterion:${systems ? 'SYSTEMS' : 'DATA'}_SNAPSHOT_CONTENT_READBACK_V1`));
    assert.ok(result.resultEvidence.some((ref) => ref.startsWith('content-sha256:')));
    assert.equal(input.sourceResolved, false);
  }
});

test('metadata y probes externos nunca se verifican usando el snapshot empresarial', () => {
  for (const sourceKind of ['CODEX_METADATA', 'EXTERNAL_ITEM_METADATA', 'EXTERNAL_SOURCE_LIVE', 'EXTERNAL_SOURCE_BLOCKED'] as const) {
    assert.equal(observeObjectiveUnit({ ...baselineReadback(), sourceKind })?.status, 'ANALYZED');
  }
});

test('rechaza citas ausentes, evidencia vacía/ajena y contexto de otra unidad, fuente, versión o criterio', () => {
  const initial = baselineReadback();
  assert.equal(observeObjectiveUnit({ ...initial, citedEvidenceKeys: ['metrics'] })?.status, 'ANALYZED');
  assert.equal(observeObjectiveUnit({ ...initial, evidence: [] })?.status, 'ANALYZED');
  assert.equal(observeObjectiveUnit({ ...initial, evidence: initial.evidence.filter((ref) => ref.evidenceKey !== 'continuousObjective') })?.status, 'ANALYZED');
  for (const patch of [{ goalId: 'another-goal' }, { unitId: 'another-unit' }, { sourceId: 'external:google_sheets' },
    { version: 2 }, { fingerprint: 'another-fingerprint' }, { criteria: ['Un criterio distinto'] }, { authority: 'UNTRUSTED_METADATA_ONLY' }]) {
    const input = structuredClone(initial);
    const context = input.evidence.find((ref) => ref.evidenceKey === 'continuousObjective')!;
    context.value = { ...context.value as object, ...patch };
    assert.equal(observeObjectiveUnit(input)?.status, 'ANALYZED', JSON.stringify(patch));
  }
  for (const patch of [{ sourceRef: 'company-os-snapshot:other-snapshot#metrics' }, { value: null }, { value: {} },
    { observedAt: '2026-09-06T01:01:00.000Z' }]) {
    const input = structuredClone(initial);
    Object.assign(input.evidence.find((ref) => ref.evidenceKey === 'metrics')!, patch);
    assert.equal(observeObjectiveUnit(input)?.status, 'ANALYZED', JSON.stringify(patch));
  }
});

test('frescura se evalúa al resultado durable: rechaza lectura anterior por más de 30 min, futura o sin fecha', () => {
  const initial = baselineReadback();
  for (const resultCreatedAt of [null, 'invalid', '2026-09-06T00:59:59.000Z', '2026-09-06T01:30:00.001Z']) {
    assert.equal(observeObjectiveUnit({ ...initial, resultCreatedAt })?.status, 'ANALYZED');
  }
  assert.equal(observeObjectiveUnit({ ...initial, resultCreatedAt: '2026-09-06T01:30:00.000Z' })?.status, 'VERIFIED');
  // Reading this immutable result later preserves its historical meaning, without implying current source health.
  assert.deepEqual(observeObjectiveUnit(initial), observeObjectiveUnit(structuredClone(initial)));
});

test('el resultado conserva sólo evidencia realmente citada y respeta el umbral instalado', () => {
  const initial = baselineReadback();
  const result = observeObjectiveUnit({ ...initial, citedEvidenceKeys: ['metrics'] })!;
  assert.deepEqual(result.resultEvidence, ['message:result-general', 'evidence:ref-metrics']);
  for (const confidence of [NaN, Infinity, 1.1]) {
    assert.equal(observeObjectiveUnit({ ...initial, confidence })?.status, 'NEEDS_REVIEW');
  }
  assert.equal(observeObjectiveUnit({ ...initial, minConfidence: 0.95 })?.status, 'NEEDS_REVIEW');
  assert.equal(observeObjectiveUnit({ ...initial, hasPendingWork: true }), null);
  assert.equal(observeObjectiveUnit({ ...initial, caseStatus: 'NEEDS_REVIEW' })?.status, 'NEEDS_REVIEW');
});
