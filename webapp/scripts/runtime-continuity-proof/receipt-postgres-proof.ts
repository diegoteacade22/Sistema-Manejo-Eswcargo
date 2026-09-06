import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { companyOsV3Prisma } from '../../lib/company-os/v3-prisma';
import { getCompanyOsRuntimeContract } from '../../lib/company-os/runtime-contracts';
import { enqueueInitialRuntimeWorkItem, claimCompanyOsRuntimeWork, heartbeatCompanyOsRuntimeWork,
  receiveAndCompleteCompanyOsRuntimeWork, reconcileCompanyOsRuntime, normalizeUsageForPersistence } from '../../lib/company-os/runtime-store';
import { receiveRuntimeResult, getCompanyOsRuntimeResultStatus } from '../../lib/company-os/runtime-result-receipts';

const url = new URL(process.env.COMPANY_OS_V3_DATABASE_URL || 'http://invalid');
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.pathname, '/company_os_proof');
// Guard accidental network use by a future store change. PostgreSQL uses its driver.
globalThis.fetch = async () => { throw new Error('NETWORK_FORBIDDEN_IN_LOCAL_FIXTURE'); };
const db = companyOsV3Prisma();
const worker = { workerId: 'runtime-continuity-local-proof', instanceId: randomUUID() };
const agentId = 'general-manager-ai-v3';
const output = { summary: 'Synthetic fixture evidence verified.', primaryDataQualityProblem: 'No inconsistency in fixture.',
  evidenceRefs: ['fixture'], recommendedNextStep: 'Wait for a new fixture revision.', missions: [], delegations: [], needsHumanDecision: false, confidence: 0.95 };
const usage = { provider: 'ollama' as const, model: 'fixture-no-model-call', inputTokens: 10, cachedTokens: 0,
  cacheWriteTokens: 0, outputTokens: 5, reasoningTokens: 0, totalTokens: 15 };
const checks: unknown[] = [];
async function seed(label: string, continuous = false) {
  const requestId = randomUUID();
  const c = await db.companyOsCase.create({ data: { requestId, agentId, objective: 'Read synthetic local fixture',
    objectiveHash: label, actorRef: 'local-fixture', authMode: 'FIXTURE', inputBudgetEstimate: 10,
    caseType: continuous ? 'CONTINUOUS_OBJECTIVE' : 'ADVISORY' } });
  await db.companyOsEvidenceRef.create({ data: { caseId: c.id, evidenceKey: 'fixture', sourceRef: 'local:synthetic-fixture', value: { label }, observedAt: new Date() } });
  if (continuous) {
    const goalId = randomUUID();
    const unitId = randomUUID();
    await db.$executeRaw`INSERT INTO public."CompanyOsContinuousObjective" (id,title,objective,status,"startsAt","endsAt","projectAllowlist",criteria,"nextScanAt","createdBy")
      VALUES (${goalId},'Synthetic gate proof','Read a synthetic source only','ACTIVE',now()-interval '1 hour',now()+interval '1 day','["AGENTE MANAGER"]'::jsonb,'["Local fixture reviewed"]'::jsonb,now()+interval '1 hour','local-fixture')`;
    await db.$executeRaw`INSERT INTO public."CompanyOsObjectiveUnit" (id,"goalId",version,"sourceId",fingerprint,"caseId",status,"ownerAgentId",priority,source,"rootKey")
      VALUES (${unitId},${goalId},1,'fixture-source',${'a'.repeat(64)},${c.id},'QUEUED',${agentId},3,'{}'::jsonb,'fixture-root')`;
    await db.companyOsEvidenceRef.create({ data: { caseId: c.id, evidenceKey: 'continuousObjective', sourceRef: 'local:fixture-authority',
      value: { recommendedSpecialist: 'systems-manager-ai-v1', goalId, unitId }, observedAt: new Date() } });
  }
  const work = await enqueueInitialRuntimeWorkItem(db, { caseId: c.id, requestId, agentId, objective: c.objective, triggerType: 'EVENT' });
  const claim = await claimCompanyOsRuntimeWork(worker);
  assert.equal(claim?.workItemId, work.id);
  assert.ok(claim);
  await heartbeatCompanyOsRuntimeWork({ ...worker, ...claim, phase: 'RUNNING' });
  return { c, work, claim, input: { ...worker, ...claim, output, usage } };
}
async function counts(caseId: string) {
  return { messages: await db.companyOsMessage.count({ where: { caseId, messageType: 'MANAGER_RESULT' } }),
    usage: await db.companyOsUsage.count({ where: { caseId } }),
    attempts: await db.companyOsExecutionAttempt.count({ where: { caseId } }),
    activeLeases: await db.companyOsLease.count({ where: { caseId, status: 'ACTIVE' } }),
    activeLocks: await db.companyOsLock.count(),
    occupiedSlots: await db.companyOsRuntimeSlot.count({ where: { leaseToken: { not: null } } }) };
}
async function verifyTerminal(label: string, needsReview: boolean) {
  const fixture = await seed(label);
  const input = { ...fixture.input, output: { ...output, needsHumanDecision: needsReview } };
  const first = await receiveAndCompleteCompanyOsRuntimeWork(input);
  assert.equal(first.state, 'COMPLETED');
  const companyCase = await db.companyOsCase.findUniqueOrThrow({ where: { id: fixture.c.id } });
  assert.equal(companyCase.status, needsReview ? 'NEEDS_REVIEW' : 'COMPLETED');
  const before = await counts(fixture.c.id);
  for (let i = 0; i < 2; i++) assert.equal((await receiveAndCompleteCompanyOsRuntimeWork(input)).state, 'COMPLETED');
  assert.deepEqual(await counts(fixture.c.id), before);
  assert.deepEqual(before, { messages: 1, usage: 1, attempts: 1, activeLeases: 0, activeLocks: 0, occupiedSlots: 0 });
  checks.push({ name: label, caseStatus: companyCase.status, duplicateResults: 0, ...before });
}
async function main() {
  await db.companyOsRuntimeControl.create({ data: { id: 'primary' } });
  await db.companyOsRuntimeSlot.createMany({ data: [{ slotNo: 1 }, { slotNo: 2 }] });
  const contract = getCompanyOsRuntimeContract(agentId);
  await db.companyOsAgentContract.create({ data: { id: randomUUID(), agentId, contractVersion: contract.version,
    name: 'Synthetic proof contract', domain: 'GENERAL', handlerKey: contract.handlerKey, status: 'INSTALLED', contract: contract as any } });
  await verifyTerminal('completed_case_repeat_complete', false);
  await verifyTerminal('needs_review_case_repeat_complete', true);
  const pending = await seed('receipt_survives_expired_lease');
  // Match the public entry point's normalization, then simulate loss before apply.
  await receiveRuntimeResult({ ...pending.input, usage: normalizeUsageForPersistence(usage) }, output);
  assert.equal((await getCompanyOsRuntimeResultStatus(pending.input)).state, 'RECEIVED');
  await db.companyOsLease.updateMany({ where: { leaseToken: pending.claim.leaseToken }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal(await claimCompanyOsRuntimeWork(worker), null, 'receipt excludes a new model attempt');
  await reconcileCompanyOsRuntime(worker.workerId);
  assert.equal((await getCompanyOsRuntimeResultStatus(pending.input)).state, 'COMPLETED');
  const recoveredCounts = await counts(pending.c.id);
  assert.deepEqual(recoveredCounts, { messages: 1, usage: 1, attempts: 1, activeLeases: 0, activeLocks: 0, occupiedSlots: 0 });
  assert.equal((await receiveAndCompleteCompanyOsRuntimeWork(pending.input)).state, 'COMPLETED');
  assert.deepEqual(await counts(pending.c.id), recoveredCounts);
  checks.push({ name: 'expired_receipt_recovers_without_new_attempt', ...recoveredCounts });
  const specialistId = 'systems-manager-ai-v1';
  const specialistContract = getCompanyOsRuntimeContract(specialistId);
  await db.companyOsAgentContract.create({ data: { id: randomUUID(), agentId: specialistId, contractVersion: specialistContract.version,
    name: 'Synthetic specialist contract', domain: 'SYSTEMS', handlerKey: specialistContract.handlerKey, status: 'INSTALLED', contract: specialistContract as any } });
  const chain = await seed('mandatory_review_with_durable_receipts', true);
  const chainResult = await receiveAndCompleteCompanyOsRuntimeWork(chain.input);
  assert.equal(chainResult.state, 'COMPLETED', 'initial work persisted');
  assert.notEqual((await db.companyOsCase.findUniqueOrThrow({ where: { id: chain.c.id } })).status, 'COMPLETED', 'case waits for required specialist');
  assert.equal(await db.companyOsWorkItem.count({ where: { caseId: chain.c.id } }), 2);
  await receiveAndCompleteCompanyOsRuntimeWork(chain.input);
  assert.equal(await db.companyOsWorkItem.count({ where: { caseId: chain.c.id } }), 2, 'replayed General output cannot duplicate specialist');
  const specialistClaim = await claimCompanyOsRuntimeWork(worker);
  assert.equal(specialistClaim?.agentId, specialistId);
  assert.ok(specialistClaim);
  const specialistOutput = { summary: 'Synthetic evidence reviewed.', primaryConfirmedRisk: 'No synthetic risk', primaryCoverageGap: 'No synthetic gap',
    confirmedRiskNextStep: 'Wait for fixture change', coverageGapNextStep: 'Wait for fixture change', evidenceRefs: ['fixture'], actionableRisks: [], missions: [], needsHumanDecision: false, confidence: 0.95 };
  const specialistInput = { ...worker, ...specialistClaim, output: specialistOutput, usage };
  await receiveAndCompleteCompanyOsRuntimeWork(specialistInput);
  await receiveAndCompleteCompanyOsRuntimeWork(specialistInput);
  assert.equal(await db.companyOsWorkItem.count({ where: { caseId: chain.c.id } }), 3, 'one integration work');
  const integrationClaim = await claimCompanyOsRuntimeWork(worker);
  assert.equal(integrationClaim?.agentId, agentId);
  assert.ok(integrationClaim);
  const integrationInput = { ...worker, ...integrationClaim, output, usage };
  assert.equal((await receiveAndCompleteCompanyOsRuntimeWork(integrationInput)).state, 'COMPLETED');
  assert.equal((await db.companyOsCase.findUniqueOrThrow({ where: { id: chain.c.id } })).status, 'COMPLETED');
  await receiveAndCompleteCompanyOsRuntimeWork(integrationInput);
  assert.equal(await db.companyOsWorkItem.count({ where: { caseId: chain.c.id } }), 3);
  assert.equal(await db.companyOsMessage.count({ where: { caseId: chain.c.id, messageType: 'DELEGATION' } }), 1);
  assert.equal(await db.companyOsMessage.count({ where: { caseId: chain.c.id, messageType: 'SPECIALIST_RESULT' } }), 1);
  const chainCounts = await counts(chain.c.id);
  assert.deepEqual(chainCounts, { messages: 2, usage: 3, attempts: 3, activeLeases: 0, activeLocks: 0, occupiedSlots: 0 });
  checks.push({ name: 'mandatory_specialist_auto_scheduled_integrated_and_all_receipts_idempotent', works: 3, delegations: 1, specialistResults: 1, ...chainCounts });
  const guards = await db.$queryRawUnsafe<Array<{ tgname: string }>>(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('company_os_runtime_case_transition_guard','company_os_runtime_work_item_transition_guard','runtime_proof_audit_append_only') ORDER BY tgname`);
  assert.equal(guards.length, 3);
  const indexes = await db.$queryRawUnsafe<Array<{ indexrelid: string; indisvalid: boolean; indisready: boolean }>>(`SELECT indexrelid::regclass::text,indisvalid,indisready FROM pg_index WHERE indexrelid IN ('public."CompanyOsAuditEvent_result_work_idx"'::regclass,'public."CompanyOsAuditEvent_result_recovery_idx"'::regclass)`);
  assert.equal(indexes.length, 2);
  assert.ok(indexes.every(index => index.indisvalid && index.indisready));
  await assert.rejects(db.companyOsCase.update({ where: { id: pending.c.id }, data: { status: 'RUNNING' } }), /Invalid Company OS case transition/);
  await assert.rejects(db.companyOsAuditEvent.updateMany({ data: { action: 'MUTATION_FORBIDDEN' } }), /append.only|immutable|mutation/i);
  checks.push({ name: 'database_transition_and_append_only_guards_enforced', guards: guards.map(x => x.tgname), receiptIndexes: indexes });
  console.log(JSON.stringify({ environment: 'EPHEMERAL_LOCAL_POSTGRESQL', modelCalls: 0, applicationFetchCalls: 0,
    productionVerified: false, continuity24x7Verified: false, databaseRole: 'isolated-fixture-superuser-no-RLS-proof', checks }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await db.$disconnect(); });
