import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CompanyOsEngineeringControlCenter,
  deriveEngineeringFreshness,
  deriveEngineeringProofGates,
  normalizeEngineeringControlCenterSnapshot,
} from '../components/company-os-engineering-control-center';

function snapshotFixture() {
  return normalizeEngineeringControlCenterSnapshot({
    generatedAt: '2026-08-27T05:00:00.000Z',
    control: {
      pauseIntake: false,
      pauseExecution: false,
      emergencyStop: false,
      quarantinedRepositories: [],
      disabledActors: [],
      updatedBy: 'diego-ceo',
      updatedAt: '2026-08-27T05:00:00.000Z',
    },
    missions: [
      { id: 'mission-a1', autonomyLevel: 'A1', status: 'COMPLETED', objective: 'A1', spentUsd: 0.1 },
      { id: 'mission-a2', autonomyLevel: 'A2', status: 'COMPLETED', objective: 'A2', spentUsd: 0.2 },
    ],
    leases: [{ id: 'lease-1', missionId: 'mission-a2', actor: 'codex-engineering-v2', status: 'RELEASED', fencingToken: '7' }],
    effects: [{
      id: 'effect-1', missionId: 'mission-a2', verb: 'CREATE_DRAFT_PR', status: 'CONFIRMED',
      remoteReadbackHash: 'a'.repeat(64), fencingToken: '7',
    }],
    events: [
      { id: 'event-1', missionId: 'mission-a2', eventType: 'LEASE_EXPIRED_RECOVERY', toStatus: 'READY', sequence: 1 },
      { id: 'event-2', missionId: 'mission-a2', eventType: 'STALE_FENCE_REJECTED', toStatus: 'RUNNING', sequence: 2 },
      { id: 'event-3', missionId: 'mission-a2', eventType: 'EMERGENCY_STOP_VERIFIED', toStatus: 'FAILED_RETRYABLE', sequence: 3 },
      { id: 'event-4', missionId: 'mission-a2', eventType: 'UNKNOWN_OUTCOME_RECONCILED', toStatus: 'READY_FOR_HUMAN', sequence: 4 },
    ],
  });
}

test('normalización es fail-closed cuando control o telemetría faltan', () => {
  const snapshot = normalizeEngineeringControlCenterSnapshot({ control: {} });
  assert.equal(snapshot.generatedAt, null);
  assert.equal(snapshot.control.pauseIntake, true);
  assert.equal(snapshot.control.pauseExecution, true);
  assert.equal(snapshot.control.emergencyStop, true);
  assert.deepEqual(snapshot.missions, []);
  assert.deepEqual(snapshot.effects, []);
});

test('freshness respeta CURRENT, STALE y UNOBSERVED sin aceptar timestamps futuros', () => {
  const now = Date.parse('2026-08-27T05:00:30.000Z');
  assert.equal(deriveEngineeringFreshness('2026-08-27T05:00:00.000Z', now), 'CURRENT');
  assert.equal(deriveEngineeringFreshness('2026-08-27T04:58:01.000Z', now), 'STALE');
  assert.equal(deriveEngineeringFreshness('2026-08-27T04:57:59.000Z', now), 'UNOBSERVED');
  assert.equal(deriveEngineeringFreshness('2026-08-27T05:01:00.000Z', now), 'UNOBSERVED');
  assert.equal(deriveEngineeringFreshness(null, now), 'UNOBSERVED');
});

test('proof gates no inventan PASS si la fuente no fue observada', () => {
  const gates = deriveEngineeringProofGates(snapshotFixture(), false);
  assert.ok(gates.every((gate) => gate.state === 'UNOBSERVED'));
});

test('A1/A2/durable requieren completions, readback y los cuatro eventos explícitos', () => {
  const gates = deriveEngineeringProofGates(snapshotFixture(), true);
  assert.equal(gates.find((gate) => gate.key === 'PASS_CONTRACT')?.state, 'UNOBSERVED');
  assert.equal(gates.find((gate) => gate.key === 'PASS_A1_LOCAL')?.state, 'PASS');
  assert.equal(gates.find((gate) => gate.key === 'PASS_A2_DRAFT_PR')?.state, 'PASS');
  assert.equal(gates.find((gate) => gate.key === 'PASS_DURABLE_V2')?.state, 'PASS');

  const missingReadback = snapshotFixture();
  missingReadback.effects[0].remoteReadbackHash = null;
  assert.equal(
    deriveEngineeringProofGates(missingReadback, true).find((gate) => gate.key === 'PASS_A2_DRAFT_PR')?.state,
    'PENDING',
  );
});

test('markup inicial muestra fail-closed, proof gates, effects, timeline y controles deshabilitados', () => {
  const markup = renderToStaticMarkup(React.createElement(CompanyOsEngineeringControlCenter));
  assert.match(markup, /Ingeniería Autónoma V2/);
  assert.match(markup, /TELEMETRÍA UNOBSERVED/);
  assert.match(markup, /Proof gates/);
  assert.match(markup, /Effects ledger/);
  assert.match(markup, /Mission timeline/);
  assert.match(markup, /Reanudar intake/);
  assert.match(markup, /Limpiar emergency stop/);
  assert.match(markup, /disabled=""/);
});

test('page integra tablero engineering antes del runtime base read-only', () => {
  const page = readFileSync('app/company-os/operations/page.tsx', 'utf8');
  assert.match(page, /CompanyOsEngineeringControlCenter/);
  assert.match(page, /<CompanyOsEngineeringControlCenter \/>/);
  assert.match(page, /CompanyOsRuntimeControlCenter readOnly/);
  assert.ok(page.indexOf('<CompanyOsEngineeringControlCenter />') < page.indexOf('<CompanyOsRuntimeControlCenter readOnly />'));
});

test('componente usa sólo lectura, control humano y pruebas acotadas V2', () => {
  const source = readFileSync('components/company-os-engineering-control-center.tsx', 'utf8');
  const probeRoute = readFileSync('app/api/company-os/engineering/v2/missions/probe/route.ts', 'utf8');
  const store = readFileSync('lib/company-os/engineering-store.ts', 'utf8');
  assert.match(source, /\/api\/company-os\/engineering\/v2\/control-center/);
  assert.match(source, /\/api\/company-os\/engineering\/v2\/control/);
  assert.match(source, /PAUSE_INTAKE/);
  assert.match(source, /PAUSE_EXECUTION/);
  assert.match(source, /EMERGENCY_STOP/);
  assert.match(source, /idempotencyKey/);
  assert.match(source, /\/api\/company-os\/engineering\/v2\/missions\/probe/);
  assert.doesNotMatch(source, /ENGINEERING_PROBE_URL\s*=\s*["']\/api\/company-os\/engineering\/v2\/missions["']/);
  assert.doesNotMatch(source, /\/api\/company-os\/engineering\/v2\/(?:claim|complete|effect\/reserve)/);
  assert.match(probeRoute, /requireHumanCompanyAdmin/);
  assert.match(probeRoute, /hasTrustedHumanRequestOrigin/);
  assert.match(probeRoute, /company-os\/proofs/);
  assert.match(probeRoute, /budgetUsd: 1/);
  assert.match(probeRoute, /deadline: new Date\(Date\.now\(\) \+ 2 \* 60 \* 60_000\)/);
  assert.match(store, /opaqueHex\(input\.baseCommit, 40/);
  assert.match(store, /opaqueHex\(input\.policyHash, 64/);
  assert.doesNotMatch(store, /const baseCommit = text\(input\.baseCommit/);
});
