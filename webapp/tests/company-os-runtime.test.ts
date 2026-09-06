import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { normalizeRuntimeUsage } from '../app/api/company-os/runtime/v1/_request';
import { estimateRuntimeCost, normalizeUsageForPersistence, validateRuntimeControlIdempotencyKey } from '../lib/company-os/runtime-store';
import { sanitizeCompanyText } from '../lib/company-os/objective';
import { deriveRuntimeAgentState, type RuntimeAgentStateWork } from '../lib/company-os/runtime-agent-status';
import {
  compareRuntimeQueuePolicy,
  isAuthenticatedRuntimeContinuation,
  runtimeQueuePolicyKey,
  type RuntimeQueuePolicyCandidate,
} from '../lib/company-os/runtime-queue-policy';
import {
  signCompanyOsEngineeringPayload,
  signCompanyOsRuntimePayload,
  verifyCompanyOsEngineeringRequest,
  verifyCompanyOsRuntimeRequest,
} from '../lib/company-os/v3-auth';

test('HMAC v2 vincula identidad, nonce, timestamp y body exacto', () => {
  process.env.COMPANY_OS_RUNTIME_HMAC_SECRET = 'runtime-test-secret';
  process.env.COMPANY_OS_RUNTIME_ALLOWED_WORKER_IDS = 'worker-test-01';
  const rawBody = JSON.stringify({ workerId: 'worker-test-01', instanceId: 'instance-test' });
  const now = Math.floor(Date.now() / 1000);
  const signed = signCompanyOsRuntimePayload(rawBody, { workerId: 'worker-test-01', nonce: 'nonce-runtime-test-0001', timestamp: now });
  const request = new Request('https://example.test/api/company-os/runtime/v1/claim', { headers: {
    'x-company-os-worker-id': signed.workerId,
    'x-company-os-nonce': signed.nonce,
    'x-company-os-timestamp': signed.timestamp,
    'x-company-os-signature': signed.signature,
    'x-company-os-signature-version': signed.signatureVersion,
  } });
  assert.deepEqual(verifyCompanyOsRuntimeRequest(request, rawBody), {
    workerId: signed.workerId, nonce: signed.nonce, timestamp: now, signatureVersion: 'v2',
  });
  assert.equal(verifyCompanyOsRuntimeRequest(request, `${rawBody} `), null);
  const otherWorker = new Request(request.url, { headers: { ...Object.fromEntries(request.headers), 'x-company-os-worker-id': 'worker-other-01' } });
  assert.equal(verifyCompanyOsRuntimeRequest(otherWorker, rawBody), null);
  delete process.env.COMPANY_OS_RUNTIME_HMAC_SECRET;
  delete process.env.COMPANY_OS_RUNTIME_ALLOWED_WORKER_IDS;
});

test('HMAC runtime no acepta secreto legado ni worker fuera de allowlist', () => {
  const rawBody = JSON.stringify({ workerId: 'worker-test-01', instanceId: 'instance-test' });
  const now = Math.floor(Date.now() / 1000);
  process.env.COMPANY_OS_V3_HMAC_SECRET = 'legacy-secret-must-not-authorize-runtime';
  process.env.COMPANY_OS_RUNTIME_ALLOWED_WORKER_IDS = 'worker-test-01';
  assert.throws(
    () => signCompanyOsRuntimePayload(rawBody, { workerId: 'worker-test-01', nonce: 'nonce-runtime-test-0002', timestamp: now }),
    /COMPANY_OS_RUNTIME_HMAC_SECRET/,
  );

  process.env.COMPANY_OS_RUNTIME_HMAC_SECRET = 'runtime-test-secret';
  const unallowedBody = JSON.stringify({ workerId: 'worker-not-allowed', instanceId: 'instance-test' });
  const signed = signCompanyOsRuntimePayload(unallowedBody, { workerId: 'worker-not-allowed', nonce: 'nonce-runtime-test-0003', timestamp: now });
  const unallowed = new Request('https://example.test/api/company-os/runtime/v1/claim', { headers: {
    'x-company-os-worker-id': signed.workerId,
    'x-company-os-nonce': signed.nonce,
    'x-company-os-timestamp': signed.timestamp,
    'x-company-os-signature': signed.signature,
    'x-company-os-signature-version': signed.signatureVersion,
  } });
  assert.equal(verifyCompanyOsRuntimeRequest(unallowed, unallowedBody), null);
  delete process.env.COMPANY_OS_RUNTIME_HMAC_SECRET;
  delete process.env.COMPANY_OS_RUNTIME_ALLOWED_WORKER_IDS;
  delete process.env.COMPANY_OS_V3_HMAC_SECRET;
});

test('Engineering V2 usa secreto, dominio y allowlist separados del runtime advisory', () => {
  const rawBody = JSON.stringify({ workerId: 'engineering-test-01', instanceId: 'instance-test' });
  const now = Math.floor(Date.now() / 1000);
  process.env.COMPANY_OS_RUNTIME_HMAC_SECRET = 'same-value-still-domain-separated';
  process.env.COMPANY_OS_ENGINEERING_HMAC_SECRET = 'same-value-still-domain-separated';
  process.env.COMPANY_OS_RUNTIME_ALLOWED_WORKER_IDS = 'engineering-test-01';
  process.env.COMPANY_OS_ENGINEERING_ALLOWED_WORKER_IDS = 'engineering-test-01';
  const signed = signCompanyOsEngineeringPayload(rawBody, {
    method: 'POST', pathname: '/api/company-os/engineering/v2/claim',
    workerId: 'engineering-test-01', nonce: 'nonce-engineering-0001', timestamp: now,
  });
  const request = new Request('https://example.test/api/company-os/engineering/v2/claim', {
    method: 'POST',
    headers: {
      'x-company-os-worker-id': signed.workerId,
      'x-company-os-nonce': signed.nonce,
      'x-company-os-timestamp': signed.timestamp,
      'x-company-os-signature': signed.signature,
      'x-company-os-signature-version': signed.signatureVersion,
    },
    body: rawBody,
  });
  assert.deepEqual(verifyCompanyOsEngineeringRequest(request, rawBody), {
    workerId: signed.workerId, nonce: signed.nonce, timestamp: now, signatureVersion: 'engineering-v3',
  });
  const crossRoute = new Request('https://example.test/api/company-os/engineering/v2/heartbeat', {
    method: 'POST', headers: request.headers, body: rawBody,
  });
  assert.equal(verifyCompanyOsEngineeringRequest(crossRoute, rawBody), null);
  assert.equal(verifyCompanyOsRuntimeRequest(request, rawBody), null);
  delete process.env.COMPANY_OS_RUNTIME_HMAC_SECRET;
  delete process.env.COMPANY_OS_ENGINEERING_HMAC_SECRET;
  delete process.env.COMPANY_OS_RUNTIME_ALLOWED_WORKER_IDS;
  delete process.env.COMPANY_OS_ENGINEERING_ALLOWED_WORKER_IDS;
});

test('runtime durable contiene concurrencia, leases, retry, heartbeat idle y no-model-on-empty', () => {
  const migration = readFileSync('../supabase/migrations/20260826003811_company_os_runtime_24x7.sql', 'utf8');
  const store = readFileSync('lib/company-os/runtime-store.ts', 'utf8');
  const daemon = readFileSync('company-os-worker/src/runtime-daemon.mjs', 'utf8');
  assert.match(migration, /CompanyOsRuntimeSlot/);
  assert.match(migration, /VALUES \(1\), \(2\)/);
  assert.match(migration, /CompanyOsLease_active_agent_key/);
  assert.match(migration, /leaseMs[\s\S]*300000/);
  assert.match(store, /FOR UPDATE OF work SKIP LOCKED/);
  assert.match(store, /FAILED_RETRYABLE/);
  assert.match(store, /WORKER_STALE_MS = 150_000/);
  assert.match(daemon, /if \(claim === null\) break/);
  assert.match(daemon, /globalConcurrency/);
});

test('salidas inválidas del modelo consumen intentos restantes y reconciliación recupera terminales prematuros', () => {
  const store = readFileSync('lib/company-os/runtime-store.ts', 'utf8');
  assert.match(store, /AUTO_RETRYABLE_MODEL_ERRORS = new Set\(\['OPENAI_INVALID_RUNTIME_OUTPUT', 'OPENAI_INVALID_JSON'\]\)/);
  assert.match(store, /input\.retryable \|\| AUTO_RETRYABLE_MODEL_ERRORS\.has\(input\.errorCode\)/);
  assert.match(store, /recoverPrematureTerminalModelFailures/);
  assert.match(store, /WORK_MODEL_FAILURE_AUTO_RECOVERED/);
  assert.match(store, /status: 'QUEUED', availableAt: now, nextAttemptAt: null/);
  assert.match(store, /ORDER BY execution\.attempt DESC/);
  assert.match(store, /work\."attemptCount"<work\."maxAttempts"/);
  assert.match(store, /NOT EXISTS \(SELECT 1 FROM public\."CompanyOsLease"/);
});

test('una revisión de contrato devuelve una sola vez los intentos consumidos antes del modelo', () => {
  const store = readFileSync('lib/company-os/runtime-store.ts', 'utf8');
  assert.match(store, /recoverExhaustedGeneralManagerContract313Failures/);
  assert.match(store, /GENERAL_MANAGER_CONTRACT_RECOVERY_VERSION = '3\.1\.4'/);
  assert.match(store, /contractVersion: '3\.1\.3'/);
  assert.match(store, /WORK_RUNTIME_CONTRACT_AUTO_RECOVERED/);
  assert.match(store, /RUNTIME_CONTRACT_FAILURE_AUTO_RECOVERED/);
  assert.match(store, /failedContractVersion: '3\.1\.3'/);
  assert.match(store, /recoveredContractVersion: currentContract\.version/);
  assert.match(store, /restoredAttemptAllowance: 3/);
  assert.match(store, /execution\.model IS NOT NULL/);
  assert.match(store, /execution\."totalTokens" IS NOT NULL/);
  assert.match(store, /execution\."errorCode" IS DISTINCT FROM 'OPENAI_INVALID_RUNTIME_OUTPUT'/);
  assert.match(store, /JOIN public\."CompanyOsUsage" usage ON usage\."attemptId"=execution\.id/);
  assert.match(store, /execution\."startedAt"<\$\{failedContract\.createdAt\}/);
  assert.match(store, /execution\."startedAt">=\$\{installedContract\.createdAt\}/);
  assert.match(store, /execution\."finishedAt" IS NULL/);
  assert.match(store, /event\."eventType"='WORK_RUNTIME_CONTRACT_AUTO_RECOVERED'/);
  assert.match(store, /company-os-runtime-contract-recovery:3\.1\.3:3\.1\.4/);
  assert.match(store, /objective\.status <> 'ACTIVE'/);
  assert.doesNotMatch(store, /if \(recoveryState\?\.inFlight\) return 0/);
  assert.match(store, /regular claim path still serializes the/);
  assert.match(store, /ORDER BY family_service\."lastCompletedAt" ASC NULLS FIRST,work\."updatedAt",work\.id/);
  assert.match(store, /FOR UPDATE OF work SKIP LOCKED LIMIT 25/);
});

test('usage local conserva provider Ollama y el servidor asigna costo cero', () => {
  const usage = normalizeRuntimeUsage({
    provider: 'ollama',
    model: 'qwen3:14b-q4_K_M',
    input_tokens: 120,
    output_tokens: 30,
    total_tokens: 150,
    retry_count: 1,
    rules_applied: ['signed-runtime-contract', 'local-loopback-inference'],
  });
  assert.equal(usage.provider, 'ollama');
  assert.equal(usage.model, 'qwen3:14b-q4_K_M');
  assert.equal(usage.totalTokens, 150);
  assert.equal(estimateRuntimeCost(usage), 0);
  assert.equal(normalizeUsageForPersistence(usage).provider, 'ollama');
  assert.equal(normalizeRuntimeUsage({ provider: 'remote-unknown' }).provider, 'openai');
});

test('un lease vencido puede volver de FAILED_RETRYABLE a CLAIMED', () => {
  const migration = readFileSync('../supabase/migrations/20260826015319_company_os_runtime_retry_claim_transition.sql', 'utf8');
  const aclMigration = readFileSync('../supabase/migrations/20260826015324_company_os_runtime_function_acl.sql', 'utf8');
  assert.match(
    migration,
    /OLD\.status = 'FAILED_RETRYABLE'[\s\S]*NEW\.status IN \('QUEUED','CLAIMED','FAILED_FINAL','BLOCKED','CANCELLED'\)/,
  );
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.company_os_runtime_guard_work_item_transition\(\) FROM PUBLIC/);
  assert.match(aclMigration, /FROM PUBLIC, anon, authenticated, service_role/);
});

test('migración runtime sólo escribe relaciones internas Company OS', () => {
  const migration = readFileSync('../supabase/migrations/20260826003811_company_os_runtime_24x7.sql', 'utf8');
  assert.doesNotMatch(migration, /(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\."?(?:Client|Product|Supplier|Order|Purchase|Shipment|Expense|Transaction)"?/i);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE/);
  assert.match(migration, /company_os_runtime_guard_case_transition/);
  assert.match(migration, /CompanyOsWorkerRequestNonce/);
});

test('rutas runtime exigen anti-replay y controles humanos separados', () => {
  const workerRequest = readFileSync('app/api/company-os/runtime/v1/_request.ts', 'utf8');
  const humanControl = readFileSync('app/api/company-os/runtime/v1/control/route.ts', 'utf8');
  assert.match(workerRequest, /verifyCompanyOsRuntimeRequest/);
  assert.match(workerRequest, /acceptCompanyOsRuntimeNonce/);
  assert.match(workerRequest, /MAX_BODY_BYTES/);
  assert.match(humanControl, /requireHumanCompanyAdmin/);
  assert.match(humanControl, /hasTrustedHumanRequestOrigin/);
  assert.doesNotMatch(humanControl, /verifyCompanyOsRuntimeRequest/);
});

test('anti-replay serializa por worker sin conflictos de snapshot y usa el reloj autoritativo de la base', () => {
  const store = readFileSync('lib/company-os/runtime-store.ts', 'utf8');
  const nonceStore = store.slice(
    store.indexOf('export async function acceptCompanyOsRuntimeNonce'),
    store.indexOf('\ntype ExpiredLeaseRow'),
  );
  assert.match(store, /SELECT 1 AS locked\s+FROM pg_catalog\.pg_advisory_xact_lock/);
  assert.doesNotMatch(store, /SELECT\s+pg_catalog\.pg_advisory_xact_lock/);
  assert.match(store, /company-os-worker-rate:\$\{workerId\}/);
  assert.match(store, /SELECT now\(\) AS now/);
  assert.match(nonceStore, /Prisma\.TransactionIsolationLevel\.ReadCommitted/);
  assert.doesNotMatch(nonceStore, /Prisma\.TransactionIsolationLevel\.Serializable/);
  assert.ok(store.indexOf('pg_advisory_xact_lock') < store.indexOf('companyOsWorkerRequestNonce.count'));
});

test('estado desconocido no se infiere como offline', () => {
  const store = readFileSync('lib/company-os/runtime-store.ts', 'utf8');
  const controlCenter = readFileSync('components/company-os-runtime-control-center.tsx', 'utf8');
  assert.match(store, /\? 'UNKNOWN' : worker\.state/);
  assert.doesNotMatch(store, /'OFFLINE'/);
  assert.match(controlCenter, /UNOBSERVED/);
});

test('control acepta exactamente la clave UI aunque el UUID contenga segmentos numéricos largos', () => {
  const key = 'ui:12345678-1234-4123-8123-123456789012';
  // This is the production regression: text redaction invalidated a legal UUID.
  assert.match(sanitizeCompanyText(key, 160).safeText, /NUMBER_REDACTED/);
  assert.equal(validateRuntimeControlIdempotencyKey(key), key);
  assert.equal(validateRuntimeControlIdempotencyKey(`  ${key}  `), key);
});

test('control rechaza claves inválidas o demasiado largas sin truncarlas a otra identidad', () => {
  for (const key of ['ui:123', 'ui:valid/key', 'ui:valid key', `ui:${'a'.repeat(158)}`]) {
    assert.throws(() => validateRuntimeControlIdempotencyKey(key), /idempotencyKey inválido/);
  }
  const limitKey = `ui:${'a'.repeat(157)}`;
  assert.equal(validateRuntimeControlIdempotencyKey(limitKey), limitKey);
});

test('heartbeat conserva el detalle criptográfico del batch externo ya validado', () => {
  const store = readFileSync('lib/company-os/runtime-store.ts', 'utf8');
  const heartbeat = store.slice(
    store.indexOf('export async function recordCompanyOsWorkerHeartbeat'),
    store.indexOf('\nasync function upsertIncident'),
  );
  assert.match(heartbeat, /externalBatchByDependencyKey/);
  assert.match(heartbeat, /formatExternalSourceDependencyDetail\(validatedExternalBatch\)/);
  assert.match(heartbeat, /dependency\.detail \? cleanText\(dependency\.detail, 500\) : null/);
});

test('control center desempata dependencias por recepción durable sin alterar su observedAt', () => {
  const store = readFileSync('lib/company-os/runtime-store.ts', 'utf8');
  assert.match(store, /observation\."observedAt" DESC,\s+observation\."createdAt" DESC, observation\.id DESC/);
});

function queueCandidate(overrides: Partial<RuntimeQueuePolicyCandidate> = {}): RuntimeQueuePolicyCandidate {
  return {
    workItemId: 'work-root-01',
    caseId: 'case-01',
    requestId: 'request-01',
    agentId: 'general-manager-ai-v3',
    priority: 50,
    attemptCount: 0,
    availableAt: new Date('2026-09-06T04:00:00Z'),
    nextAttemptAt: null,
    createdAt: new Date('2026-09-05T18:00:00Z'),
    familyLastCompletedAt: null,
    causalCaseId: 'case-01',
    causalKind: 'ORDER',
    causalMessageType: 'HUMAN_ORDER',
    causalFromAgentId: null,
    causalToAgentId: 'general-manager-ai-v3',
    causalDeliveryStatus: 'DELIVERED',
    causalCorrelationId: 'request-01',
    causalIdempotencyKey: 'runtime-message:root:order',
    causalExpectsResponse: false,
    causalCausationId: null,
    ...overrides,
  };
}

test('claim implementa lanes de retry, servicio por familia y continuaciones causales acotadas', () => {
  const store = readFileSync('lib/company-os/runtime-store.ts', 'utf8');
  const claim = store.slice(
    store.indexOf('export async function claimCompanyOsRuntimeWork'),
    store.indexOf('\nasync function requireRuntimeLease'),
  );
  const policy = readFileSync('lib/company-os/runtime-queue-policy.ts', 'utf8');
  assert.match(policy, /RUNTIME_RETRY_FAIRNESS_AGE_MS = 15 \* 60_000/);
  assert.match(policy, /RUNTIME_CONTINUATION_PRIORITY_GAP = 1/);
  assert.match(claim, /WITH family_service AS MATERIALIZED/);
  assert.match(claim, /MAX\(candidate_work\.priority\) OVER \(\) AS "maxEligiblePriority"/);
  assert.match(claim, /company_case\.status NOT IN \('COMPLETED','CANCELLED','FAILED_FINAL'\)/);
  assert.match(claim, /objective\.status <> 'ACTIVE'/);
  assert.match(claim, /CompanyOsAgentContract" installed[\s\S]*installed\.status = 'INSTALLED'/);
  assert.match(claim, /causal\."deliveryStatus" = 'DELIVERED'/);
  assert.match(claim, /causal\."correlationId" = company_case\."requestId"/);
  assert.match(claim, /causal\."idempotencyKey" LIKE 'runtime-message:%:delegation:%:' \|\| work\."agentId"/);
  assert.match(claim, /causal\."idempotencyKey" LIKE 'runtime-message:%:attempt:%:result'/);
  assert.match(claim, /work\.priority >= eligible\."maxEligiblePriority" - \$\{RUNTIME_CONTINUATION_PRIORITY_GAP\}/);
  assert.match(claim, /WHEN work\."attemptCount" > 0\s+AND COALESCE\(work\."nextAttemptAt", work\."availableAt"\) <= \$\{agedRetryBefore\} THEN 0/);
  assert.match(claim, /WHEN work\."attemptCount" = 0 THEN 1\s+ELSE 2/);
  assert.match(claim, /CASE WHEN work\."attemptCount" = 0 THEN family_service\."lastCompletedAt" END ASC NULLS FIRST/);
  assert.match(claim, /COALESCE\(work\."nextAttemptAt", work\."availableAt"\), work\."createdAt", work\.id/);
  assert.match(claim, /FOR UPDATE OF work SKIP LOCKED/);
});

test('retry usa nextAttemptAt y cambia de lane exactamente a los 15 minutos', () => {
  const now = new Date('2026-09-06T04:30:00Z');
  const base = queueCandidate({ attemptCount: 1, availableAt: new Date('2026-09-04T04:00:00Z') });
  const recent = queueCandidate({ ...base, workItemId: 'retry-1459', nextAttemptAt: new Date('2026-09-06T04:15:01Z') });
  const aged = queueCandidate({ ...base, workItemId: 'retry-1500', nextAttemptAt: new Date('2026-09-06T04:15:00Z') });
  assert.equal(runtimeQueuePolicyKey(recent, { now, maxEligiblePriority: 50 })[2], 2);
  assert.equal(runtimeQueuePolicyKey(aged, { now, maxEligiblePriority: 50 })[2], 0);
  assert.equal(runtimeQueuePolicyKey(recent, { now, maxEligiblePriority: 50 })[4], recent.nextAttemptAt?.getTime());
});

test('delegación y retorno auténticos adelantan un punto, pero no dos', () => {
  const delegation = queueCandidate({
    workItemId: 'delegation-01', agentId: 'data-manager-ai-v1', priority: 49,
    causalKind: 'ORDER', causalMessageType: 'DELEGATION', causalFromAgentId: 'general-manager-ai-v3',
    causalToAgentId: 'data-manager-ai-v1', causalExpectsResponse: true, causalCausationId: 'result-root-01',
    causalIdempotencyKey: 'runtime-message:root-work:delegation:0:data-manager-ai-v1',
  });
  const specialistReturn = queueCandidate({
    workItemId: 'return-01', priority: 49, causalKind: 'RESULT', causalMessageType: 'SPECIALIST_RESULT',
    causalFromAgentId: 'data-manager-ai-v1', causalToAgentId: 'general-manager-ai-v3',
    causalExpectsResponse: true, causalCausationId: 'delegation-message-01',
    causalIdempotencyKey: 'runtime-message:specialist-work:attempt:1:result',
  });
  const root = queueCandidate({ workItemId: 'priority-50-root', priority: 50 });
  const input = { now: new Date('2026-09-06T04:00:01Z'), maxEligiblePriority: 50 };
  assert.equal(isAuthenticatedRuntimeContinuation(delegation), true);
  assert.equal(isAuthenticatedRuntimeContinuation(specialistReturn), true);
  assert.ok(compareRuntimeQueuePolicy(delegation, root, input) < 0);
  assert.ok(compareRuntimeQueuePolicy(specialistReturn, root, input) < 0);
  assert.equal(runtimeQueuePolicyKey({ ...delegation, priority: 48 }, input)[0], 1);
});

test('continuación pendiente, falsificada o cruzada no recibe preferencia; su retry auténtico sí', () => {
  const authentic = queueCandidate({
    agentId: 'systems-manager-ai-v1', priority: 49,
    causalKind: 'ORDER', causalMessageType: 'DELEGATION', causalFromAgentId: 'general-manager-ai-v3',
    causalToAgentId: 'systems-manager-ai-v1', causalExpectsResponse: true, causalCausationId: 'root-result-01',
    causalIdempotencyKey: 'runtime-message:root-work:delegation:0:systems-manager-ai-v1',
  });
  assert.equal(isAuthenticatedRuntimeContinuation({ ...authentic, causalDeliveryStatus: 'PENDING' }), false);
  assert.equal(isAuthenticatedRuntimeContinuation({ ...authentic, causalFromAgentId: 'data-manager-ai-v1' }), false);
  assert.equal(isAuthenticatedRuntimeContinuation({ ...authentic, causalCaseId: 'case-other' }), false);
  assert.equal(isAuthenticatedRuntimeContinuation({ ...authentic, attemptCount: 1 }), true);
  const freshRoot = queueCandidate({ workItemId: 'fresh-root', priority: 50 });
  assert.ok(compareRuntimeQueuePolicy(
    { ...authentic, attemptCount: 1, nextAttemptAt: new Date('2026-09-06T04:00:00Z') },
    freshRoot,
    { now: new Date('2026-09-06T04:00:01Z'), maxEligiblePriority: 50 },
  ) < 0);
});

test('familia sin servicio obtiene un turno antes de familias ya atendidas', () => {
  const now = new Date('2026-09-06T04:00:01Z');
  const served = queueCandidate({ workItemId: 'served-family', familyLastCompletedAt: new Date('2026-09-05T04:00:00Z'), createdAt: new Date('2026-09-05T04:00:00Z') });
  const unserved = queueCandidate({ workItemId: 'unserved-family', familyLastCompletedAt: null, createdAt: new Date('2026-09-05T18:00:00Z') });
  assert.ok(compareRuntimeQueuePolicy(unserved, served, { now, maxEligiblePriority: 50 }) < 0);
});

const statusNow = new Date('2026-09-02T12:10:00Z');
const agentStatusFixture = {
  agentId: 'systems-manager-ai-v1', installed: true, paused: false,
  now: statusNow, staleMs: 150_000,
  workers: [{ workerId: 'worker-24x7', state: 'IDLE', allowedAgentIds: ['systems-manager-ai-v1'], lastHeartbeatAt: new Date('2026-09-02T12:09:55Z') }],
};
const historicalBlocked: RuntimeAgentStateWork = {
  agentId: 'systems-manager-ai-v1', status: 'BLOCKED', requestId: 'historical-budget-failure',
  updatedAt: new Date('2026-08-28T12:00:36Z'), completedAt: null, leaseWorkerId: null, leaseExpiresAt: null,
};
const laterCompleted: RuntimeAgentStateWork = {
  ...historicalBlocked, status: 'COMPLETED', requestId: 'later-success',
  updatedAt: new Date('2026-09-02T12:01:19Z'), completedAt: new Date('2026-09-02T12:01:19Z'),
};

test('worker habilitado y éxito posterior muestran IDLE sin alterar el fallo histórico', () => {
  const workItems = [historicalBlocked, laterCompleted];
  assert.deepEqual(deriveRuntimeAgentState({ ...agentStatusFixture, workItems }), { status: 'IDLE', currentCaseId: null });
  assert.equal(workItems[0].status, 'BLOCKED');
  assert.equal(workItems.length, 2);
  const recentFailure = { ...historicalBlocked, updatedAt: new Date('2026-09-02T12:02:00Z') };
  assert.equal(deriveRuntimeAgentState({ ...agentStatusFixture, workItems: [laterCompleted, recentFailure] }).status, 'BLOCKED');
});

test('heartbeat de otro agente o vencido no prueba disponibilidad del especialista', () => {
  const input = { ...agentStatusFixture, workItems: [historicalBlocked, laterCompleted] };
  assert.equal(deriveRuntimeAgentState({ ...input, workers: [{ ...input.workers[0], allowedAgentIds: ['general-manager-ai-v3'] }] }).status, 'UNKNOWN');
  assert.equal(deriveRuntimeAgentState({ ...input, workers: [{ ...input.workers[0], allowedAgentIds: [] }] }).status, 'UNKNOWN');
  assert.equal(deriveRuntimeAgentState({ ...input, workers: [{ ...input.workers[0], lastHeartbeatAt: new Date('2026-09-02T12:00:00Z') }] }).status, 'UNKNOWN');
});

test('actividad actual requiere lease vigente del worker habilitado y tiene prioridad sobre histórico', () => {
  const live: RuntimeAgentStateWork = {
    ...historicalBlocked, status: 'RUNNING', requestId: 'current-case', updatedAt: statusNow,
    leaseWorkerId: 'worker-24x7', leaseExpiresAt: new Date('2026-09-02T12:15:00Z'),
  };
  const input = { ...agentStatusFixture, workItems: [historicalBlocked, live] };
  assert.deepEqual(deriveRuntimeAgentState(input), { status: 'RUNNING', currentCaseId: 'current-case' });
  assert.equal(deriveRuntimeAgentState({ ...input, workItems: [{ ...live, status: 'CLAIMED' }] }).status, 'RUNNING');
  assert.equal(deriveRuntimeAgentState({ ...input, workItems: [{ ...live, leaseExpiresAt: statusNow }] }).status, 'UNKNOWN');
  assert.equal(deriveRuntimeAgentState({ ...input, workItems: [{ ...live, leaseWorkerId: 'other-worker' }] }).status, 'UNKNOWN');
  assert.equal(deriveRuntimeAgentState({ ...input, workers: [{ ...input.workers[0], allowedAgentIds: [] }] }).status, 'UNKNOWN');
  assert.equal(deriveRuntimeAgentState({ ...input, paused: true }).status, 'PAUSED');
  assert.equal(deriveRuntimeAgentState({ ...input, installed: false }).status, 'NOT_INSTALLED');
});

test('worker detenido, iniciando o drenando sin trabajo vivo no se presenta disponible', () => {
  for (const state of ['STOPPED', 'STARTING', 'DRAINING']) {
    assert.equal(deriveRuntimeAgentState({
      ...agentStatusFixture, workers: [{ ...agentStatusFixture.workers[0], state }], workItems: [laterCompleted],
    }).status, 'UNKNOWN');
  }
});
