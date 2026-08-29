import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (relative: string) => readFileSync(path.join(root, relative), 'utf8');

test('Goal Reconciler persists immutable goals and append-only observations behind forced RLS', () => {
  const migration = read('../supabase/migrations/20260829191734_company_os_goal_reconciler_v1.sql');
  assert.match(migration, /CREATE TABLE public\."CompanyOsEngineeringGoal"/);
  assert.match(migration, /CREATE TABLE public\."CompanyOsEngineeringGoalSignal"/);
  assert.match(migration, /GoalSpec contract is immutable/);
  assert.match(migration, /goal_signal_append_only/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/g);
  assert.match(migration, /REVOKE ALL ON TABLE[\s\S]*FROM PUBLIC, anon, authenticated, service_role, company_os_reader/);
  assert.match(migration, /TO company_os_v3/);
  assert.match(migration, /GRANT SELECT ON public\."CompanyOsEngineeringGoal" TO company_os_v3/);
  assert.match(migration, /GRANT SELECT, INSERT ON public\."CompanyOsEngineeringGoalSignal" TO company_os_v3/);
  assert.doesNotMatch(migration, /GRANT (?:INSERT|UPDATE|DELETE)[^;]*"CompanyOsEngineeringGoal" TO company_os_v3/);
  assert.doesNotMatch(migration, /CREATE POLICY[^;]*goal_(?:insert|update|delete)[\s\S]*?ON public\."CompanyOsEngineeringGoal"/i);
});

test('Goal Reconciler limits V1 sources and replaces the complete mission guard', () => {
  const migration = read('../supabase/migrations/20260829191734_company_os_goal_reconciler_v1.sql');
  const schema = read('prisma/schema.prisma');
  assert.match(migration, /"sourceKind" text NOT NULL CHECK \("sourceKind" = 'REPOSITORY_DOCUMENT'\)/);
  assert.doesNotMatch(migration, /COMPANY_OS_DOCUMENT/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.company_os_engineering_guard_mission\(\)[\s\S]*Engineering intake is fail-closed/);
  assert.match(migration, /Engineering repository is quarantined/);
  assert.match(migration, /Engineering mission contract is immutable/);
  assert.match(migration, /Engineering transition requires its append-only event first/);
  assert.match(migration, /Engineering mission has an unconfirmed or unknown effect/);
  assert.match(migration, /NEW\."goalId" IS DISTINCT FROM OLD\."goalId"[\s\S]*NEW\."contractVersion" IS DISTINCT FROM OLD\."contractVersion"[\s\S]*NEW\."desiredState" IS DISTINCT FROM OLD\."desiredState"[\s\S]*NEW\."maxAttempts" IS DISTINCT FROM OLD\."maxAttempts"/);
  assert.match(migration, /Engineering goalId and desiredState must be present together/);
  assert.match(migration, /goal_row\.status <> 'ACTIVE'/);
  assert.match(migration, /NEW\."contractVersion" <> '2\.1\.0'/);
  assert.match(migration, /OLD\.status NOT IN \('READY','READY_FOR_EFFECT'\)/);
  assert.match(migration, /SET "nextAttemptAt" = LEAST\("nextAttemptAt", deadline\)[\s\S]*WHERE "nextAttemptAt" > deadline/);
  assert.match(migration, /Engineering retry deadline requires its failure event first/);
  assert.match(migration, /latest_event\."eventType" NOT IN \([\s\S]*'ENGINEERING_MISSION_FAILED'[\s\S]*'ORPHANED_LEASE_RECOVERY'/);
  assert.match(migration, /'EMERGENCY_STOP_RECOVERY',[\s\S]*'EXECUTION_PAUSED_RECOVERY'/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.company_os_engineering_guard_event\(\)[\s\S]*NEW\."fromStatus" = NEW\."toStatus"[\s\S]*'UNKNOWN_OUTCOME_RECONCILED'/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.company_os_engineering_guard_event\(\)/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.company_os_engineering_guard_effect\(\)[\s\S]*lease_row\."allowedPaths" <> mission_row\."allowedPaths"[\s\S]*NOT lease_row\."allowedVerbs" @> pg_catalog\.jsonb_build_array\(NEW\.verb\)/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.company_os_engineering_guard_effect\(\)/);
  assert.match(schema, /@@index\(\[status, nextAttemptAt, deadline\], map: "CompanyOsEngineeringMission_retry_due_idx"\)/);
  assert.match(migration, /CompanyOsEngineeringMission_one_effective_goal_key[\s\S]*status NOT IN \('COMPLETED','FAILED_FINAL','CANCELLED'\)/);
  assert.match(migration, /A2 mission cannot complete without a confirmed branch/);
  assert.match(migration, /A2 mission cannot complete without a confirmed Draft PR/);
  assert.match(migration, /is_safety_reconciliation := mission_row\.status = 'READY_FOR_EFFECT'[\s\S]*NEW\."allowedVerbs" = '\["READ_REPOSITORY"\]'::jsonb[\s\S]*status = 'UNKNOWN_OUTCOME'/);
  assert.match(migration, /'PAUSED',[\s\S]*'migration:company-os-goal-reconciler-v1'/);
  assert.doesNotMatch(schema, /goalId\s+String\?\s+@unique/);
  assert.match(schema, /@@index\(\[status, priority\(sort: Desc\), createdAt\]\)/);
  assert.match(schema, /@@index\(\[goalId, createdAt\(sort: Desc\)\]\)/);
});

test('signed worker may observe desired state but cannot author GoalSpecs', () => {
  const goalsRoute = read('app/api/company-os/engineering/v2/autonomy/goals/route.ts');
  const observeRoute = read('app/api/company-os/engineering/v2/autonomy/observe/route.ts');
  const store = read('lib/company-os/engineering-store.ts');
  assert.match(goalsRoute, /verifiedRuntimeJson/);
  assert.match(observeRoute, /verifiedRuntimeJson/);
  const engineeringRequest = read('app/api/company-os/engineering/v2/_request.ts');
  assert.match(engineeringRequest, /verifyCompanyOsEngineeringRequest/);
  assert.doesNotMatch(engineeringRequest, /verifyCompanyOsRuntimeRequest/);
  assert.match(store, /listActiveEngineeringGoals/);
  assert.match(store, /reconcileEngineeringGoalObservation/);
  assert.match(store, /observedSatisfied/);
  assert.match(store, /engineeringHash/);
  assert.doesNotMatch(`${goalsRoute}\n${observeRoute}`, /companyOsEngineeringGoal\.(create|update|upsert)/);
});

test('worker uses structured desired-state reconciliation and retains A2 draft-only ceiling', () => {
  const reconciler = read('company-os-engineering-worker/src/goal-reconciler.mjs');
  const runner = read('company-os-engineering-worker/src/runner.mjs');
  const policy = read('company-os-engineering-worker/src/policy.mjs');
  assert.match(reconciler, /FILE_CONTAINS/);
  assert.match(reconciler, /SOURCE_HASH_MISMATCH/);
  assert.match(reconciler, /reconcileIfDue/);
  assert.match(policy, /CREATE_DRAFT_PR/);
  assert.match(runner, /isDraft !== true/);
  assert.doesNotMatch(runner, /'MERGE'|'DEPLOY'/);
});
