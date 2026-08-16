import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolveAtomicMissionDecision } from '../lib/company-os/v3-store';

type Mission = { id: string; status: string };
type DecisionResult = { mission: Mission; decision: 'APPROVE' | 'REJECT'; idempotencyKey: string };

class MissionStore {
  mission: Mission = { id: 'mission-1', status: 'PLANNED' };
  decisions = new Map<string, DecisionResult>();
  private locked = false;
  private waiters: Array<() => void> = [];

  async transaction(decision: DecisionResult['decision'], idempotencyKey: string) {
    let release: (() => void) | undefined;
    try {
      return await resolveAtomicMissionDecision({
        findExisting: async () => this.decisions.get(idempotencyKey) ?? null,
        targetStatus: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        readCurrent: (mission) => ({ mission: { ...mission }, decision, idempotencyKey }),
        lockMission: async () => {
          if (this.locked) await new Promise<void>((resolve) => this.waiters.push(resolve));
          this.locked = true;
          release = () => {
            this.locked = false;
            this.waiters.shift()?.();
          };
          return { ...this.mission };
        },
        persist: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          this.mission = { ...this.mission, status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED' };
          const result = { mission: { ...this.mission }, decision, idempotencyKey };
          this.decisions.set(idempotencyKey, result);
          return result;
        },
      });
    } finally {
      release?.();
    }
  }
}

test('APPROVE y REJECT concurrentes producen una sola decisión terminal', async () => {
  const store = new MissionStore();
  const results = await Promise.allSettled([
    store.transaction('APPROVE', 'approve-key'),
    store.transaction('REJECT', 'reject-key'),
  ]);

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  assert.equal(store.decisions.size, 1);
  assert.ok(['APPROVED', 'REJECTED'].includes(store.mission.status));
  const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  assert.match(String(rejected?.reason), /decisión humana terminal/);
});

test('reintentar la misma idempotencyKey devuelve el resultado original', async () => {
  const store = new MissionStore();
  const first = await store.transaction('APPROVE', 'stable-key');
  store.mission = { ...store.mission, status: 'REJECTED' };
  const retry = await store.transaction('APPROVE', 'stable-key');

  assert.equal(first.reused, false);
  assert.equal(retry.reused, true);
  assert.deepEqual(retry.value, first.value);
  assert.equal(store.decisions.size, 1);
  assert.equal(store.mission.status, 'REJECTED');
});

test('dos reintentos concurrentes con la misma clave persisten una vez y comparten resultado', async () => {
  const store = new MissionStore();
  const [first, second] = await Promise.all([
    store.transaction('APPROVE', 'concurrent-stable-key'),
    store.transaction('APPROVE', 'concurrent-stable-key'),
  ]);

  assert.equal([first, second].filter((result) => result.reused === false).length, 1);
  assert.equal([first, second].filter((result) => result.reused === true).length, 1);
  assert.deepEqual(first.value, second.value);
  assert.equal(store.decisions.size, 1);
});

test('RUNNING y DONE no admiten ninguna decisión humana', async () => {
  for (const status of ['RUNNING', 'DONE']) {
    const store = new MissionStore();
    store.mission = { ...store.mission, status };
    await assert.rejects(store.transaction('APPROVE', `blocked-${status}`), /no autoriza modificar/);
    assert.equal(store.decisions.size, 0);
    assert.equal(store.mission.status, status);
  }
});

test('la implementación bloquea caso y misión y nunca proyecta RUNNING/DONE', () => {
  const source = readFileSync(new URL('../lib/company-os/v3-store.ts', import.meta.url), 'utf8');
  assert.match(source, /FOR UPDATE OF c, m/);
  assert.match(source, /existingAfterLock/);
  assert.match(source, /La decisión requiere un motivo auditable/);
  assert.match(source, /target === 'RUNNING' \|\| target === 'DONE'/);
  assert.doesNotMatch(source, /APPROVE:\s*'RUNNING'|REJECT:\s*'DONE'/);
  assert.ok(source.indexOf('const persistedDecision = await tx.companyOsDecision.create') < source.indexOf('const updated = await tx.companyOsMission.update'));
});
