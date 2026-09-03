import assert from 'node:assert/strict';
import test from 'node:test';
import { nextRuntimeBudgetReset, planAdaptiveRuntimeBudget, planRuntimeBudget, startOfZonedPeriod } from '../lib/company-os/runtime-budget';

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

const adaptiveBase = { ...base, targetTotalTokens: 12_000, maxOutputTokens: 3_000 };

test('reserva adaptativa conserva 9000 de input y usa sólo el remanente real de salida', () => {
  const input = { ...adaptiveBase, dailyUsed: 37_582 };
  assert.deepEqual(planAdaptiveRuntimeBudget(input), {
    allowed: true, requestedTokens: 10_418, targetTotalTokens: 10_418, maxOutputTokens: 1_418, adapted: true,
  });
  assert.equal(input.requested, 12_000);
  assert.equal(input.dailyLimit, 48_000);
  assert.equal(input.maxOutputTokens, 3_000);
  assert.deepEqual(planAdaptiveRuntimeBudget({ ...adaptiveBase, dailyUsed: 36_000 }), {
    allowed: true, requestedTokens: 12_000, targetTotalTokens: 12_000, maxOutputTokens: 3_000, adapted: false,
  });
});

test('mínimo de salida incluye ambos límites y todas las reservas activas', () => {
  assert.deepEqual(planAdaptiveRuntimeBudget({ ...adaptiveBase, dailyUsed: 37_000, reserved: 1_000 }), {
    allowed: true, requestedTokens: 10_000, targetTotalTokens: 10_000, maxOutputTokens: 1_000, adapted: true,
  });
  assert.deepEqual(planAdaptiveRuntimeBudget({ ...adaptiveBase, dailyUsed: 0, monthlyUsed: 989_500, reserved: 250 }), {
    allowed: true, requestedTokens: 10_250, targetTotalTokens: 10_250, maxOutputTokens: 1_250, adapted: true,
  });
  const insufficient = { ...adaptiveBase, dailyUsed: 37_000, reserved: 1_001 };
  assert.deepEqual(planAdaptiveRuntimeBudget(insufficient), {
    ...planRuntimeBudget(insufficient), requestedTokens: 12_000, targetTotalTokens: 12_000, maxOutputTokens: 3_000, adapted: false,
  });
  const monthly = { ...adaptiveBase, dailyUsed: 0, monthlyUsed: 990_001 };
  assert.deepEqual(planAdaptiveRuntimeBudget(monthly), {
    allowed: false, reason: 'MONTHLY', retryAt: new Date('2026-10-01T04:00:00Z'),
    requestedTokens: 12_000, targetTotalTokens: 12_000, maxOutputTokens: 3_000, adapted: false,
  });
});

test('no aumenta una reserva previa ni un máximo de salida menor a 1000', () => {
  assert.deepEqual(planAdaptiveRuntimeBudget({ ...adaptiveBase, requested: 10_500, dailyUsed: 0 }), {
    allowed: true, requestedTokens: 10_500, targetTotalTokens: 10_500, maxOutputTokens: 1_500, adapted: true,
  });
  const smallOutput = { ...adaptiveBase, dailyUsed: 36_000, maxOutputTokens: 500 };
  assert.deepEqual(planAdaptiveRuntimeBudget(smallOutput), {
    allowed: true, requestedTokens: 12_000, targetTotalTokens: 12_000, maxOutputTokens: 500, adapted: false,
  });
  assert.equal(planAdaptiveRuntimeBudget({ ...smallOutput, dailyUsed: 36_001 }).allowed, false);
});

test('contratos y aritmética inválidos fallan cerrado sin reparación implícita', () => {
  for (const patch of [
    { targetTotalTokens: 0 }, { targetTotalTokens: Number.NaN }, { maxOutputTokens: 0 },
    { maxOutputTokens: 12_000 }, { maxOutputTokens: 12_001 }, { requested: 12_001 },
    { requested: 9_999 }, { dailyUsed: Number.MAX_SAFE_INTEGER, reserved: 1 },
    { monthlyUsed: Number.MAX_SAFE_INTEGER, reserved: 1 }, { maxOutputTokens: 1.5 },
  ]) assert.throws(() => planAdaptiveRuntimeBudget({ ...adaptiveBase, ...patch }), /budget|reservation/);
  const impossible = { ...adaptiveBase, dailyLimit: 11_000 };
  assert.deepEqual(planAdaptiveRuntimeBudget(impossible), {
    allowed: false, reason: 'REQUEST_EXCEEDS_LIMIT', retryAt: null,
    requestedTokens: 12_000, targetTotalTokens: 12_000, maxOutputTokens: 3_000, adapted: false,
  });
});

test('toda admisión conserva input y respeta cuotas sin aumentar la reserva ni salida', () => {
  for (const dailyUsed of [0, 35_999, 36_000, 37_582, 38_000, 38_001, 48_000]) {
    for (const reserved of [0, 1, 500, 12_000]) {
      for (const monthlyUsed of [0, 988_000, 989_999, 990_001, 1_000_000]) {
        const input = { ...adaptiveBase, dailyUsed, reserved, monthlyUsed };
        const plan = planAdaptiveRuntimeBudget(input);
        if (!plan.allowed) {
          assert.equal(plan.adapted, false);
          assert.equal(plan.requestedTokens, input.requested);
          continue;
        }
        assert.equal(plan.targetTotalTokens - plan.maxOutputTokens, 9_000);
        assert.ok(plan.maxOutputTokens >= 1_000 && plan.maxOutputTokens <= input.maxOutputTokens);
        assert.ok(plan.requestedTokens <= input.requested);
        assert.equal(plan.requestedTokens, plan.targetTotalTokens);
        assert.ok(dailyUsed + reserved + plan.requestedTokens <= input.dailyLimit);
        assert.ok(monthlyUsed + reserved + plan.requestedTokens <= input.monthlyLimit);
      }
    }
  }
});
