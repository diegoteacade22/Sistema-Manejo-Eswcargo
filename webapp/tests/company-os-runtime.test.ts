import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { normalizeRuntimeUsage } from '../app/api/company-os/runtime/v1/_request';
import { estimateRuntimeCost, normalizeUsageForPersistence } from '../lib/company-os/runtime-store';
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

test('anti-replay serializa por worker y usa el reloj autoritativo de la base', () => {
  const store = readFileSync('lib/company-os/runtime-store.ts', 'utf8');
  assert.match(store, /SELECT 1 AS locked\s+FROM pg_catalog\.pg_advisory_xact_lock/);
  assert.doesNotMatch(store, /SELECT\s+pg_catalog\.pg_advisory_xact_lock/);
  assert.match(store, /company-os-worker-rate:\$\{workerId\}/);
  assert.match(store, /SELECT now\(\) AS now/);
  assert.match(store, /Prisma\.TransactionIsolationLevel\.Serializable/);
  assert.ok(store.indexOf('pg_advisory_xact_lock') < store.indexOf('companyOsWorkerRequestNonce.count'));
});

test('estado desconocido no se infiere como offline', () => {
  const store = readFileSync('lib/company-os/runtime-store.ts', 'utf8');
  const controlCenter = readFileSync('components/company-os-runtime-control-center.tsx', 'utf8');
  assert.match(store, /\? 'UNKNOWN' : worker\.state/);
  assert.doesNotMatch(store, /'OFFLINE'/);
  assert.match(controlCenter, /UNOBSERVED/);
});
