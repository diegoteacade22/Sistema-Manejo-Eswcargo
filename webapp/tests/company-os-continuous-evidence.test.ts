import assert from 'node:assert/strict';
import test from 'node:test';
import { continuousCaseBudgets, materializeContinuousCaseEvidence } from '../lib/company-os/continuous-case-evidence';
import { continuousBaselineFingerprint } from '../lib/company-os/continuous-objective-runner';

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
