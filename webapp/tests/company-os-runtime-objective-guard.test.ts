import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Prisma } from '@prisma/client';
import { runtimeObjectiveIsActive, withRuntimeObjectiveClaimFence } from '../lib/company-os/runtime-objective-guard';

const now = new Date('2026-09-03T03:00:00Z');
const active = { status: 'ACTIVE', startsAt: new Date('2026-09-03T02:00:00Z'), endsAt: new Date('2026-09-03T04:00:00Z'), checkedAt: now };
const candidate = { caseId: 'objective-case', caseType: 'CONTINUOUS_OBJECTIVE' };

test('objective authority includes start and excludes deadline, paused, expired and invalid clocks', () => {
  assert.equal(runtimeObjectiveIsActive(active, now), true);
  assert.equal(runtimeObjectiveIsActive(active, active.startsAt), true);
  assert.equal(runtimeObjectiveIsActive(active, active.endsAt), false);
  for (const goal of [{ ...active, status: 'PAUSED' }, { ...active, status: 'EXPIRED' }, { ...active, startsAt: new Date('2026-09-04T00:00:00Z') }, { ...active, endsAt: new Date(NaN) }]) {
    assert.equal(runtimeObjectiveIsActive(goal, now), false);
  }
});

test('the objective share lock precedes work revalidation, including a lost work race', async () => {
  const order: string[] = [];
  const tx = { async $queryRaw(query: Prisma.Sql) {
    assert.match(query.sql, /FOR SHARE OF objective/);
    assert.match(query.sql, /clock_timestamp\(\)/);
    assert.deepEqual(query.values, ['objective-case']);
    order.push('objective-share-lock');
    return [active];
  } } as unknown as Prisma.TransactionClient;
  assert.equal(await withRuntimeObjectiveClaimFence(tx, candidate, async () => { order.push('work-lock-revalidate'); return null; }), null);
  assert.deepEqual(order, ['objective-share-lock', 'work-lock-revalidate']);
});

test('paused or missing objective never reaches work lock or lease callback', async () => {
  for (const rows of [[], [{ ...active, status: 'PAUSED' }], [{ ...active, checkedAt: active.endsAt }]]) {
    const tx = { async $queryRaw() { return rows; } } as unknown as Prisma.TransactionClient;
    assert.equal(await withRuntimeObjectiveClaimFence(tx, candidate, async () => { assert.fail('must not claim'); }), null);
  }
});

test('existing advisory cases retain eligibility; linked nonstandard cases cannot bypass pause', async () => {
  const legacy = { ...candidate, caseType: 'ADVISORY' };
  const unlinked = { async $queryRaw() { return []; } } as unknown as Prisma.TransactionClient;
  assert.equal(await withRuntimeObjectiveClaimFence(unlinked, legacy, async () => 'claimed'), 'claimed');
  const paused = { async $queryRaw() { return [{ ...active, status: 'PAUSED' }]; } } as unknown as Prisma.TransactionClient;
  assert.equal(await withRuntimeObjectiveClaimFence(paused, legacy, async () => { assert.fail('must not claim'); }), null);
});

test('authority read/serialization errors fail closed without entering work callback', async () => {
  const tx = { async $queryRaw() { throw new Error('SERIALIZATION_FAILURE'); } } as unknown as Prisma.TransactionClient;
  await assert.rejects(withRuntimeObjectiveClaimFence(tx, candidate, async () => { assert.fail('must not claim'); }), /SERIALIZATION_FAILURE/);
});

test('runtime fences before the lease and legacy claims exclude continuous objectives', () => {
  const runtime = readFileSync(new URL('../lib/company-os/runtime-store.ts', import.meta.url), 'utf8');
  const claim = runtime.slice(runtime.indexOf('export async function claimCompanyOsRuntimeWork'), runtime.indexOf('async function requireRuntimeLease'));
  assert.ok(claim.indexOf('withRuntimeObjectiveClaimFence(tx') < claim.indexOf('tx.companyOsLease.create'));
  assert.match(claim, /selectCandidates\(observed.workItemId\)/);
  assert.match(claim, /objective\."endsAt" <= clock_timestamp\(\)/);
  assert.match(claim, /company_case\."caseType" <> 'CONTINUOUS_OBJECTIVE' OR EXISTS/);
  const legacy = readFileSync(new URL('../lib/company-os/v3-store.ts', import.meta.url), 'utf8').split('export async function claimCompanyOsCase')[1];
  assert.match(legacy, /c\."caseType" <> 'CONTINUOUS_OBJECTIVE'/);
});
