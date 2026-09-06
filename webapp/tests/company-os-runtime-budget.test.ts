import assert from 'node:assert/strict';
import test from 'node:test';
import { nextRuntimeBudgetReset, planRuntimeBudget, startOfZonedPeriod } from '../lib/company-os/runtime-budget';

const base = { now: new Date('2026-09-03T02:00:00Z'), dailyUsed: 39_510, monthlyUsed: 39_510, reserved: 0, requested: 12_000, dailyLimit: 48_000, monthlyLimit: 1_000_000 };

test('agotamiento diario aplaza a medianoche New York sin elevar el presupuesto', () => {
  const decision = planRuntimeBudget(base);
  assert.deepEqual(decision, { allowed: false, reason: 'DAILY', retryAt: new Date('2026-09-03T04:00:00Z') });
  assert.equal(base.dailyUsed, 39_510);
  assert.deepEqual(planRuntimeBudget({ ...base, dailyUsed: 0 }), { allowed: true });
  assert.deepEqual(planRuntimeBudget({ ...base, dailyUsed: 36_000 }), { allowed: true });
  assert.equal(planRuntimeBudget({ ...base, dailyUsed: 36_000, reserved: 1 }).allowed, false);
});

test('agotamiento mensual espera siguiente mes aunque el día reinicie primero', () => {
  const decision = planRuntimeBudget({ ...base, monthlyUsed: 995_000 });
  assert.deepEqual(decision, { allowed: false, reason: 'DAILY_AND_MONTHLY', retryAt: new Date('2026-10-01T04:00:00Z') });
  assert.deepEqual(planRuntimeBudget({ ...base, dailyUsed: 0, monthlyUsed: 995_000 }), { allowed: false, reason: 'MONTHLY', retryAt: new Date('2026-10-01T04:00:00Z') });
});

test('reloj de presupuesto respeta DST y cambio de año', () => {
  assert.equal(startOfZonedPeriod(new Date('2026-03-08T16:00:00Z'), 'day').toISOString(), '2026-03-08T05:00:00.000Z');
  assert.equal(nextRuntimeBudgetReset(new Date('2026-03-08T16:00:00Z'), 'day').toISOString(), '2026-03-09T04:00:00.000Z');
  assert.equal(startOfZonedPeriod(new Date('2026-11-01T16:00:00Z'), 'day').toISOString(), '2026-11-01T04:00:00.000Z');
  assert.equal(nextRuntimeBudgetReset(new Date('2026-11-01T16:00:00Z'), 'day').toISOString(), '2026-11-02T05:00:00.000Z');
  assert.equal(nextRuntimeBudgetReset(new Date('2026-12-31T23:59:00Z'), 'month').toISOString(), '2027-01-01T05:00:00.000Z');
});

test('reserva imposible y contadores inválidos no crean reintento infinito', () => {
  assert.deepEqual(planRuntimeBudget({ ...base, requested: 48_001 }), { allowed: false, reason: 'REQUEST_EXCEEDS_LIMIT', retryAt: null });
  assert.throws(() => planRuntimeBudget({ ...base, dailyUsed: Number.NaN }), /Invalid runtime budget/);
  assert.throws(() => planRuntimeBudget({ ...base, monthlyUsed: -1 }), /Invalid runtime budget/);
});
