import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { hasTrustedHumanRequestOrigin, requireHumanCompanyAdmin } from '../lib/company-os/human-admin';
import {
  computeMissionEventHash,
  effectiveMissionRevision,
  MissionDecisionError,
  missionTransition,
  normalizeMissionDecision,
  verifyMissionEventChain,
  type MissionEventRecord,
} from '../lib/company-os/mission-events';

test('las cinco decisiones humanas proyectan sólo estados permitidos', () => {
  assert.equal(missionTransition('PLANNED', 'APPROVE'), 'APPROVED');
  assert.equal(missionTransition('APPROVED', 'REJECT'), 'REJECTED');
  assert.equal(missionTransition('APPROVED', 'EDIT'), 'REVIEW');
  assert.equal(missionTransition('APPROVED', 'POSTPONE'), 'PLANNED');
  assert.equal(missionTransition('REVIEW', 'MARK_INCORRECT'), 'BLOCKED');
});

test('RUNNING y DONE son inalcanzables mediante decisiones V2', () => {
  for (const action of ['APPROVE', 'REJECT', 'EDIT', 'POSTPONE', 'MARK_INCORRECT'] as const) {
    assert.throws(() => missionTransition('RUNNING', action), MissionDecisionError);
    assert.throws(() => missionTransition('DONE', action), MissionDecisionError);
  }
});

test('valida motivo, revisión, información incorrecta, diferimiento e idempotencia', () => {
  const now = new Date('2026-08-16T01:00:00.000Z');
  assert.throws(() => normalizeMissionDecision({
    missionId: 'mission-1', action: 'REJECT', expectedHead: 0, idempotencyKey: 'decision-001',
  }, now), /motivo/);
  assert.throws(() => normalizeMissionDecision({
    missionId: 'mission-1', action: 'EDIT', expectedHead: 0, idempotencyKey: 'decision-002',
  }, now), /revisionPayload/);
  assert.throws(() => normalizeMissionDecision({
    missionId: 'mission-1', action: 'EDIT', expectedHead: 0, idempotencyKey: 'decision-002b',
    revisionPayload: { execute: 'comprar' },
  }, now), /sólo admite/);
  assert.throws(() => normalizeMissionDecision({
    missionId: 'mission-1', action: 'MARK_INCORRECT', expectedHead: 0, idempotencyKey: 'decision-003', reason: 'Dato viejo',
  }, now), /incorrectData/);
  assert.throws(() => normalizeMissionDecision({
    missionId: 'mission-1', action: 'POSTPONE', expectedHead: 0, idempotencyKey: 'decision-004', deferUntil: now.toISOString(),
  }, now), /futuro/);
  assert.throws(() => normalizeMissionDecision({
    missionId: 'mission-1', action: 'APPROVE', expectedHead: 0, idempotencyKey: 'short',
  }, now), /idempotencyKey/);

  const valid = normalizeMissionDecision({
    missionId: 'mission-1',
    action: 'POSTPONE',
    expectedHead: 2,
    idempotencyKey: 'decision-005',
    deferUntil: '2026-08-17T01:00:00.000Z',
    reason: 'Revisar mañana',
  }, now);
  assert.equal(valid.deferUntil?.toISOString(), '2026-08-17T01:00:00.000Z');
});

test('la cadena hash detecta secuencia, enlace o contenido alterado', () => {
  const firstBase: Omit<MissionEventRecord, 'id' | 'eventHash'> = {
    missionId: 'mission-1',
    sequence: 1,
    action: 'APPROVE',
    fromStatus: 'PLANNED',
    toStatus: 'APPROVED',
    actorRef: '12345678901234567890',
    authMode: 'admin-session',
    reason: null,
    deferUntil: null,
    revisionPayload: null,
    incorrectData: null,
    expectedHead: 0,
    idempotencyKey: 'decision-101',
    requestHash: 'a'.repeat(64),
    previousHash: null,
    createdAt: new Date('2026-08-16T01:00:00.000Z'),
  };
  const first: MissionEventRecord = { id: 'event-1', ...firstBase, eventHash: computeMissionEventHash(firstBase) };
  const secondBase: Omit<MissionEventRecord, 'id' | 'eventHash'> = {
    ...firstBase,
    sequence: 2,
    action: 'EDIT',
    fromStatus: 'APPROVED',
    toStatus: 'REVIEW',
    revisionPayload: { mission: 'Versión revisada' },
    expectedHead: 1,
    idempotencyKey: 'decision-102',
    requestHash: 'b'.repeat(64),
    previousHash: first.eventHash,
    createdAt: new Date('2026-08-16T01:01:00.000Z'),
  };
  const second: MissionEventRecord = { id: 'event-2', ...secondBase, eventHash: computeMissionEventHash(secondBase) };
  assert.equal(verifyMissionEventChain([first, second]), true);
  const thirdBase: Omit<MissionEventRecord, 'id' | 'eventHash'> = {
    ...secondBase,
    sequence: 3,
    action: 'APPROVE',
    fromStatus: 'REVIEW',
    toStatus: 'APPROVED',
    revisionPayload: null,
    expectedHead: 2,
    idempotencyKey: 'decision-103',
    requestHash: 'c'.repeat(64),
    previousHash: second.eventHash,
    createdAt: new Date('2026-08-16T01:02:00.000Z'),
  };
  const third: MissionEventRecord = { id: 'event-3', ...thirdBase, eventHash: computeMissionEventHash(thirdBase) };
  assert.deepEqual(effectiveMissionRevision([first, second, third]), { mission: 'Versión revisada' });
  assert.equal(verifyMissionEventChain([first, { ...second, reason: 'alterado' }]), false);
  assert.equal(verifyMissionEventChain([{ ...first, sequence: 2 }]), false);
});

test('la clave de máquina recibe 403 antes de consultar una sesión humana', async () => {
  const previousKey = process.env.COMPANY_OS_API_KEY;
  process.env.COMPANY_OS_API_KEY = 'machine-key-for-test';
  try {
    const result = await requireHumanCompanyAdmin(new Request('https://example.test', {
      headers: { authorization: 'Bearer machine-key-for-test' },
    }));
    assert.deepEqual(result, {
      ok: false,
      status: 403,
      error: 'La clave de máquina no puede tomar decisiones humanas',
    });
    const { POST } = await import('../app/api/company-os/missions/route');
    const response = await POST(new Request('https://example.test/api/company-os/missions', {
      method: 'POST',
      headers: {
        authorization: 'Bearer machine-key-for-test',
        'content-type': 'application/json',
        origin: 'https://example.test',
      },
      body: JSON.stringify({}),
    }));
    assert.equal(response.status, 403);
    assert.match(await response.text(), /clave de máquina/);
  } finally {
    if (previousKey == null) delete process.env.COMPANY_OS_API_KEY;
    else process.env.COMPANY_OS_API_KEY = previousKey;
  }
});

test('POST humano rechaza origen cruzado y acepta únicamente same-origin', () => {
  assert.equal(hasTrustedHumanRequestOrigin(new Request('https://manager.example/api/company-os/missions', {
    headers: { origin: 'https://manager.example' },
  })), true);
  assert.equal(hasTrustedHumanRequestOrigin(new Request('https://manager.example/api/company-os/missions', {
    headers: { origin: 'https://attacker.example' },
  })), false);
  assert.equal(hasTrustedHumanRequestOrigin(new Request('https://manager.example/api/company-os/missions', {
    headers: { origin: 'not-a-url' },
  })), false);
});

test('la migración endurece concurrencia, RLS y append-only', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20260816013313_company_agent_mission_events_v2.sql', import.meta.url), 'utf8');
  const store = readFileSync(new URL('../lib/company-os/mission-events.ts', import.meta.url), 'utf8');
  assert.match(sql, /UNIQUE INDEX "CompanyAgentMissionEvent_missionId_sequence_key"/);
  assert.match(sql, /UNIQUE INDEX "CompanyAgentMissionEvent_missionId_idempotencyKey_key"/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON TABLE "CompanyAgentMissionEvent" FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /BEFORE UPDATE OR DELETE/);
  assert.match(sql, /"sequence" = "expectedHead" \+ 1/);
  assert.match(sql, /GRANT INSERT ON "CompanyAgentMissionEvent" TO company_os_reader/);
  assert.doesNotMatch(sql, /INSERT INTO ("Order"|"Product"|"Purchase"|"Payment"|"Shipment")/);
  assert.match(store, /companyReadPrisma\(\)/);
  assert.doesNotMatch(store, /from '@\/lib\/prisma'/);

  const hardening = readFileSync(new URL('../../supabase/migrations/20260816013901_company_os_v2_calibration_hardening.sql', import.meta.url), 'utf8');
  assert.match(hardening, /BEFORE INSERT ON public\."CompanyAgentMissionEvent"/);
  assert.match(hardening, /NEW\."previousHash" IS DISTINCT FROM latest_hash/);
  assert.match(hardening, /NEW\."fromStatus" IS DISTINCT FROM latest_status/);
  assert.match(hardening, /pg_advisory_xact_lock/);
});
