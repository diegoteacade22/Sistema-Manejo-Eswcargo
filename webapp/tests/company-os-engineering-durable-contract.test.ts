import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const schema = readFileSync('prisma/schema.prisma', 'utf8');
const migration = readFileSync(
  '../supabase/migrations/20260827051150_company_os_autonomous_engineering_v2_durable.sql',
  'utf8',
);
const recoveryMigration = readFileSync(
  '../supabase/migrations/20260827052700_company_os_engineering_recovery_hardening.sql',
  'utf8',
);
const proofMigration = readFileSync(
  '../supabase/migrations/20260827053500_company_os_engineering_proof_events.sql',
  'utf8',
);
const store = readFileSync('lib/company-os/engineering-store.ts', 'utf8');

function prismaModel(name: string) {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `missing Prisma model ${name}`);
  return match[1];
}

test('schema materializa un plano durable de ingeniería separado', () => {
  const mission = prismaModel('CompanyOsEngineeringMission');
  const lease = prismaModel('CompanyOsEngineeringCapabilityLease');
  const event = prismaModel('CompanyOsEngineeringEvent');
  const effect = prismaModel('CompanyOsEngineeringEffect');
  const control = prismaModel('CompanyOsEngineeringControl');

  assert.match(mission, /missionHash\s+String\s+@unique/);
  assert.match(mission, /stateVersion\s+Int\s+@default\(1\)/);
  assert.match(mission, /fencingCounter\s+BigInt\s+@default\(0\)/);
  assert.match(lease, /@@unique\(\[missionId, fencingToken\]\)/);
  assert.match(event, /@@unique\(\[missionId, sequence\]\)/);
  assert.match(event, /@@unique\(\[missionId, idempotencyKey\]\)/);
  assert.match(effect, /idempotencyKey\s+String\s+@unique/);
  assert.match(effect, /requestHash\s+String/);
  assert.match(control, /pauseIntake\s+Boolean\s+@default\(true\)/);
  assert.match(control, /pauseExecution\s+Boolean\s+@default\(true\)/);
  assert.match(control, /emergencyStop\s+Boolean\s+@default\(true\)/);
  assert.match(control, /quarantinedRepositories\s+String\[\]/);
  assert.match(control, /disabledActors\s+String\[\]/);
});

test('migración nace fail-closed y separa misión, capability, evento y efecto', () => {
  for (const relation of [
    'CompanyOsEngineeringControl',
    'CompanyOsEngineeringMission',
    'CompanyOsEngineeringCapabilityLease',
    'CompanyOsEngineeringEvent',
    'CompanyOsEngineeringEffect',
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE public\\."${relation}"`));
  }
  assert.match(migration, /VALUES \('primary', true, true, true, 'migration:fail-closed'\)/);
  assert.match(migration, /"autonomyLevel" IN \('A1','A2'\)/);
  assert.match(migration, /verb IN \('PUSH_BRANCH','CREATE_DRAFT_PR'\)/);
  assert.match(migration, /"targetHeadBranch" LIKE 'codex\/%'/);
});

test('fencing se emite bajo lock y siempre crece desde estado canónico', () => {
  assert.match(migration, /company_os_engineering_issue_fenced_lease\(\)/);
  assert.match(migration, /CompanyOsEngineeringMission"[\s\S]*WHERE id = NEW\."missionId"[\s\S]*FOR UPDATE/);
  assert.match(migration, /next_token := mission_row\."fencingCounter" \+ 1/);
  assert.match(migration, /NEW\."fencingToken" := next_token/);
  assert.match(migration, /SET "fencingCounter" = next_token/);
  assert.match(migration, /WHERE "missionId" = NEW\."missionId" AND status = 'ACTIVE'/);
  assert.match(migration, /NEW\."fencingToken" <> mission_row\."fencingCounter"/);
});

test('state guards exigen evento previo y bloquean completar efectos inciertos', () => {
  assert.match(migration, /company_os_engineering_transition_allowed\(old_state text, new_state text\)/);
  assert.match(migration, /Engineering transition requires its append-only event first/);
  assert.match(migration, /NEW\."stateVersion" <> OLD\."stateVersion" \+ 1/);
  assert.match(migration, /status <> 'CONFIRMED'/);
  assert.match(migration, /A2 mission cannot complete without a confirmed effect/);
  assert.match(migration, /'DISPATCHING' THEN new_state IN \('CONFIRMED','UNKNOWN_OUTCOME','FAILED'\)/);
  assert.match(migration, /'UNKNOWN_OUTCOME' THEN new_state IN \('CONFIRMED','FAILED'\)/);
  assert.match(migration, /Confirmed engineering effect requires destination readback/);
});

test('recovery reclama efectos persistidos y separa reconciliación de nueva ejecución', () => {
  assert.match(recoveryMigration, /mission_row\.status NOT IN \('READY','READY_FOR_EFFECT'\)/);
  assert.match(store, /mission\.status = 'READY_FOR_EFFECT'[\s\S]*EXISTS \([\s\S]*CompanyOsEngineeringEffect/);
  assert.match(store, /const allowedVerbs = reconciliationOnly[\s\S]*\['READ_REPOSITORY'\]/);
  assert.match(store, /if \(mode === 'EXECUTE'\)[\s\S]*attemptCount: \{ increment: 1 \}/);
  assert.match(store, /where: \{ capabilityLeaseId: lease\.id, status: 'DISPATCHING' \}/);
  assert.match(store, /status: 'UNKNOWN_OUTCOME', lastErrorCode: 'LEASE_EXPIRED_DURING_EFFECT'/);
  assert.match(store, /LEASE_EXPIRED_BEFORE_EFFECT_RESERVATION/);
  assert.match(store, /ORPHANED_BEFORE_EFFECT_RESERVATION/);
  assert.match(store, /effects: \{ none: \{\} \}/);
  assert.match(store, /where: \{ missionId: mission\.id \}, orderBy: \{ createdAt: 'asc' \}/);
  assert.match(store, /status: 'RELEASED', revokedAt: new Date\(\)/);
});

test('proof gates tienen eventos persistibles sin convertir observación en transición', () => {
  for (const eventType of ['UNKNOWN_OUTCOME_RECONCILED', 'STALE_FENCE_REJECTED', 'EMERGENCY_STOP_VERIFIED']) {
    assert.match(proofMigration, new RegExp(`'${eventType}'`));
  }
  assert.match(proofMigration, /NEW\."fromStatus" = NEW\."toStatus"/);
  assert.match(store, /eventType: 'UNKNOWN_OUTCOME_RECONCILED'/);
  assert.match(store, /eventType: 'STALE_FENCE_REJECTED'/);
  assert.match(store, /eventType: 'EMERGENCY_STOP_VERIFIED'/);
});

test('eventos son append-only, serializados, hash-linked e idempotentes por request hash', () => {
  assert.match(migration, /pg_advisory_xact_lock\(pg_catalog\.hashtextextended\('engineering-event:' \|\| NEW\."missionId", 0\)\)/);
  assert.match(migration, /NEW\.sequence <> previous_event\.sequence \+ 1/);
  assert.match(migration, /NEW\."previousHash" <> previous_event\."eventHash"/);
  assert.match(migration, /UNIQUE \("missionId", "idempotencyKey"\)/);
  assert.match(migration, /"requestHash" text NOT NULL CHECK \("requestHash" ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  assert.match(migration, /company_os_engineering_event_append_only/);
  assert.match(migration, /company_os_v3_reject_mutation\(\)/);
  assert.match(migration, /NEW\."requestHash" <> OLD\."requestHash"/);
});

test('kill switch, pausas, quarantine y actor disable se aplican fuera del modelo', () => {
  assert.match(migration, /control_row\."emergencyStop" OR control_row\."pauseIntake"/);
  assert.match(migration, /control_row\."emergencyStop" OR control_row\."pauseExecution"/);
  assert.match(migration, /mission_row\.repository = ANY\(control_row\."quarantinedRepositories"\)/);
  assert.match(migration, /NEW\.actor = ANY\(control_row\."disabledActors"\)/);
  assert.match(migration, /lease_row\.actor = ANY\(control_row\."disabledActors"\)/);
  assert.match(migration, /Engineering effect dispatch is stopped or fenced/);
});

test('RLS y grants quedan limitados a company_os_v3 sin autoridad empresarial', () => {
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.%I FROM PUBLIC, anon, authenticated, service_role, company_os_reader/);
  assert.match(migration, /GRANT SELECT, INSERT ON public\."CompanyOsEngineeringEvent" TO company_os_v3/);
  assert.doesNotMatch(migration, /GRANT\s+DELETE\s+ON/i);

  const grants = migration.match(/GRANT\b[\s\S]*?;/g) ?? [];
  assert.ok(grants.length >= 5);
  for (const grant of grants) {
    assert.match(grant, /CompanyOsEngineering|FUNCTION public\.company_os_engineering/);
    assert.doesNotMatch(grant, /"(?:Client|Product|Supplier|Order|Transaction|Shipment|Purchase|Expense)"/);
  }
});
