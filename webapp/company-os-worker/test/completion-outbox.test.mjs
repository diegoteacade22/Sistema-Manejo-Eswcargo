import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, statSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CompletionOutbox, completionEntry, completionHash } from '../src/completion-outbox.mjs';
import { CompanyOsWorker } from '../src/worker.mjs';
import { CompanyOsRuntimeApiClient } from '../src/runtime-api-client.mjs';
import { CompanyOsRuntimeDaemon } from '../src/runtime-daemon.mjs';
import { runtimeSignedHeaders } from '../src/runtime-signing.mjs';

const claim = { leaseToken: 'lease-test', requestId: 'request-test', caseId: 'case-test', agentId: 'agent-test',
  workItemId: 'work-test', attemptId: 'attempt-test', slotNo: 1, objective: 'PRIVATE OBJECTIVE', evidencePayload: { private: 'PRIVATE EVIDENCE' } };
const output = { summary: 'Result already generated', nested: { z: 1, a: 2 } };
const usage = { provider: 'ollama', model: 'local', input_tokens: 12, output_tokens: 9, total_tokens: 21 };
const outage = () => { throw Object.assign(new Error('Unsafe echoed body PRIVATE EVIDENCE'), { code: 'NETWORK_FAILURE' }); };
function stateDirectory(t) {
  const path = mkdtempSync(join(tmpdir(), 'company-os-outbox-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}
function fixture(stateDir, overrides = {}) {
  const calls = { generated: 0, fail: 0, complete: [], status: [], errors: [] };
  const api = { workerId: 'worker-original', instanceId: 'instance-original', heartbeat: async () => ({}),
    fail: async () => { calls.fail += 1; },
    complete: async (...args) => { calls.complete.push(args); return {}; },
    resultStatus: async (identity) => { calls.status.push(identity); return { state: 'COMPLETED', resultHash: completionHash(output) }; }, ...overrides };
  const worker = new CompanyOsWorker({ api, outbox: new CompletionOutbox({ stateDir }),
    openai: { generate: async () => { calls.generated += 1; return { output, usage }; } }, onError: (error) => calls.errors.push(error) });
  return { worker, calls, api };
}

test('lost complete acknowledgement reconciles readback without fail or regeneration', async (t) => {
  const { worker, calls } = fixture(stateDirectory(t), { complete: outage });
  const result = await worker.runClaim(claim);
  assert.equal(result.status, 'COMPLETED');
  assert.equal(calls.generated, 1);
  assert.equal(calls.fail, 0);
  assert.equal(worker.pendingCompletionCount, 0);
  assert.deepEqual(calls.errors, []);
});

test('lost request retries the same durable result and usage with a bounded attempt count', async (t) => {
  let sends = 0;
  const sent = [];
  const { worker, calls } = fixture(stateDirectory(t), {
    complete: async (...args) => { sends += 1; sent.push(args); if (sends === 1) outage(); },
    resultStatus: async () => ({ state: sends > 1 ? 'COMPLETED' : 'NOT_FOUND', resultHash: completionHash(output) }),
  });
  assert.equal((await worker.runClaim(claim)).status, 'COMPLETED');
  assert.equal(sends, 2);
  assert.deepEqual(sent[0], sent[1]);
  assert.deepEqual(sent[0][2], usage);
  assert.equal(calls.generated, 1);
  assert.equal(calls.fail, 0);
});

test('restart during API outage replays original identity without generating or logging output', async (t) => {
  const stateDir = stateDirectory(t);
  const first = fixture(stateDir, { complete: outage, resultStatus: outage });
  assert.equal((await first.worker.runClaim(claim)).status, 'PERSISTENCE_PENDING');
  assert.equal(first.worker.pendingCompletionCount, 1);
  const second = fixture(stateDir, { workerId: 'worker-new', instanceId: 'instance-new' });
  let received = false;
  second.api.resultStatus = async () => ({ state: received ? 'COMPLETED' : 'NOT_FOUND', resultHash: completionHash(output) });
  second.api.complete = async (identity, result, consumed) => {
    assert.equal(identity.workerId, 'worker-original');
    assert.equal(identity.leaseInstanceId, 'instance-original');
    assert.equal(identity.attemptId, claim.attemptId);
    assert.equal(identity.objective, undefined);
    assert.equal(identity.evidencePayload, undefined);
    assert.deepEqual(result, output);
    assert.deepEqual(consumed, usage);
    received = true;
  };
  assert.deepEqual(await second.worker.drainCompletions(), { pending: 0, blocked: false });
  assert.equal(received, true);
  assert.equal(second.calls.generated, 0);
  assert.equal(first.calls.fail + second.calls.fail, 0);
  assert.deepEqual([...first.calls.errors, ...second.calls.errors], []);
});

test('a successful complete without readback remains pending; superseded is archived, not completed', async (t) => {
  const { worker, api, calls } = fixture(stateDirectory(t), { resultStatus: async () => ({ state: 'RECEIVED' }) });
  assert.equal((await worker.runClaim(claim)).status, 'PERSISTENCE_PENDING');
  assert.equal(calls.complete.length, 2);
  api.resultStatus = async () => ({ state: 'SUPERSEDED', resultHash: completionHash(output) });
  const [entry] = worker.outbox.load();
  assert.equal((await worker.deliverCompletion(entry, { replay: true })).status, 'SUPERSEDED');
  assert.equal(worker.pendingCompletionCount, 0);
});

test('hash mismatch never deletes result or claims completion', async (t) => {
  const { worker, calls } = fixture(stateDirectory(t), { resultStatus: async () => ({ state: 'COMPLETED', resultHash: 'different' }) });
  const result = await worker.runClaim(claim);
  assert.equal(result.status, 'PERSISTENCE_PENDING');
  assert.equal(result.error.code, 'COMPLETION_HASH_MISMATCH');
  assert.equal(worker.pendingCompletionCount, 1);
  assert.equal(calls.fail, 0);
});

test('outbox write failure retains result in memory, forbids inference, and recovers', async (t) => {
  const stateDir = stateDirectory(t);
  const { worker, calls } = fixture(stateDir);
  worker.outbox.load();
  const directory = worker.outbox.directory;
  rmSync(directory, { recursive: true });
  writeFileSync(directory, 'simulate unavailable directory');
  assert.equal((await worker.runClaim(claim)).status, 'PERSISTENCE_PENDING');
  assert.equal(worker.pendingCompletionCount, 1);
  assert.equal(calls.complete.length, 0);
  assert.equal((await worker.runClaim({ ...claim, workItemId: 'other', attemptId: 'other' })).status, 'PERSISTENCE_PENDING');
  assert.equal(calls.generated, 1);
  assert.equal(calls.fail, 0);
  rmSync(directory);
  assert.deepEqual(await worker.drainCompletions(), { pending: 0, blocked: false });
});

test('durable records have restrictive modes and exclude prompt, evidence, HMAC and output secrets', (t) => {
  const stateDir = stateDirectory(t);
  const outbox = new CompletionOutbox({ stateDir });
  const entry = completionEntry(claim, { summary: 'token=do-not-store', credentials: 'private-value' }, usage,
    { workerId: 'worker-original', instanceId: 'instance-original', hmacSecret: 'signing-key-do-not-store' });
  outbox.persist(entry);
  const [filename] = readdirSync(outbox.directory);
  const raw = readFileSync(join(outbox.directory, filename), 'utf8');
  assert.equal(statSync(outbox.directory).mode & 0o777, 0o700);
  assert.equal(statSync(join(outbox.directory, filename)).mode & 0o777, 0o600);
  assert.doesNotMatch(raw, /PRIVATE OBJECTIVE|PRIVATE EVIDENCE|signing-key-do-not-store|private-value|do-not-store/);
  assert.equal(completionHash({ b: 2, a: { z: 3, y: 4 } }), completionHash({ a: { y: 4, z: 3 }, b: 2 }));
});

test('corrupt outbox fails closed before model or claims', async (t) => {
  const stateDir = stateDirectory(t);
  const { worker, calls } = fixture(stateDir);
  worker.outbox.ensureDirectory();
  writeFileSync(join(worker.outbox.directory, `${'a'.repeat(64)}.json`), '{partial');
  assert.equal((await worker.runClaim(claim)).status, 'PERSISTENCE_PENDING');
  assert.equal(calls.generated, 0);
  assert.equal(calls.fail, 0);
  assert.deepEqual(await worker.drainCompletions(), { pending: 0, blocked: true });
});

test('signed replay uses original worker and lease instance with current process instance', async () => {
  const sent = [];
  const api = new CompanyOsRuntimeApiClient({ baseUrl: 'https://runtime.example', hmacSecret: 'test-secret', workerId: 'new-worker', instanceId: 'new-instance',
    now: () => 1_800_000_000_000, nonceFactory: () => 'fixed-nonce-1234567890',
    fetchImpl: async (url, init) => { sent.push({ url, init }); return new Response('{}'); } });
  const identity = { ...claim, workerId: 'old-worker', leaseInstanceId: 'old-instance' };
  await api.complete(identity, output, usage);
  await api.resultStatus(identity);
  for (const { init } of sent) {
    const body = JSON.parse(init.body);
    assert.equal(body.workerId, 'old-worker');
    assert.equal(body.instanceId, 'new-instance');
    assert.equal(body.leaseInstanceId, 'old-instance');
    const expected = runtimeSignedHeaders({ secret: 'test-secret', workerId: 'old-worker', rawBody: init.body, nowMs: 1_800_000_000_000, nonce: 'fixed-nonce-1234567890' });
    for (const [name, value] of Object.entries(expected)) assert.equal(init.headers[name], value);
    assert.equal(body.objective, undefined);
  }
});

test('daemon startup and polls drain pending results before any new claim, exposing DEGRADED safely', async (t) => {
  const stateDir = stateDirectory(t);
  const first = fixture(stateDir, { complete: outage, resultStatus: outage });
  await first.worker.runClaim(claim);
  const second = fixture(stateDir, { resultStatus: outage });
  const logs = [];
  let claims = 0;
  second.api.claim = async () => { claims += 1; return null; };
  second.api.workerHeartbeat = async () => ({});
  const daemon = new CompanyOsRuntimeDaemon({ config: { stateDir, workerId: 'worker-original', version: 'test', globalConcurrency: 1,
    pollIntervalMs: 60_000, workerHeartbeatIntervalMs: 60_000, reconcileIntervalMs: 60_000, scheduleIntervalMs: 60_000, shutdownGraceMs: 10 },
    api: second.api, processor: second.worker, logger: { info: (...args) => logs.push(args), error: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
    lock: { acquire() {}, release() {} }, healthServerFactory: () => ({ listen: async () => ({}), close: async () => {} }) });
  await daemon.start({ runImmediately: false });
  t.after(() => daemon.stop());
  await daemon.tickPoll();
  assert.equal(daemon.snapshot().state, 'DEGRADED');
  assert.equal(daemon.snapshot().pendingCompletionCount, 1);
  assert.equal(daemon.snapshot().acceptingWork, false);
  assert.equal(claims, 0);
  second.api.resultStatus = async () => ({ state: 'COMPLETED', resultHash: completionHash(output) });
  await daemon.tickPoll();
  assert.equal(claims, 1);
  assert.equal(second.calls.generated, 0);
  assert.equal(daemon.snapshot().state, 'IDLE');
  assert.doesNotMatch(JSON.stringify(logs), /PRIVATE EVIDENCE|Result already generated|lease-test/);
});


test('process exit after durable write is recovered by another worker without model access', async (t) => {
  const stateDir = stateDirectory(t);
  const workerModule = new URL('../src/worker.mjs', import.meta.url).href;
  const outboxModule = new URL('../src/completion-outbox.mjs', import.meta.url).href;
  const script = `import { CompanyOsWorker } from ${JSON.stringify(workerModule)};
    import { CompletionOutbox } from ${JSON.stringify(outboxModule)};
    const worker = new CompanyOsWorker({outbox: new CompletionOutbox({stateDir: ${JSON.stringify(stateDir)}}),
      api: {workerId:'worker-original',instanceId:'instance-original',heartbeat:async()=>({}),complete:async()=>process.exit(27)},
      openai:{generate:async()=>(${JSON.stringify({ output, usage })})}});
    await worker.runClaim(${JSON.stringify(claim)});`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 5_000 });
  assert.equal(child.status, 27, child.stderr);
  const { worker, calls } = fixture(stateDir);
  assert.deepEqual(await worker.drainCompletions(), { pending: 0, blocked: false });
  assert.equal(calls.generated, 0);
  assert.equal(calls.fail, 0);
});

test('shutdown just after generation preserves output and usage instead of failing the attempt', async (t) => {
  const { worker, calls } = fixture(stateDirectory(t));
  const controller = new AbortController();
  worker.openai.generate = async () => { controller.abort(); return { output, usage }; };
  assert.equal((await worker.runClaim(claim, { signal: controller.signal })).status, 'COMPLETED');
  assert.equal(calls.fail, 0);
  assert.deepEqual(calls.complete[0][2], usage);
});

test('recover complete temporary record left between fsync and rename', async (t) => {
  const stateDir = stateDirectory(t);
  const { worker, api } = fixture(stateDir);
  const entry = completionEntry(claim, output, usage, api);
  worker.outbox.persist(entry);
  const [filename] = readdirSync(worker.outbox.directory);
  const raw = readFileSync(join(worker.outbox.directory, filename));
  writeFileSync(join(worker.outbox.directory, filename.replace('.json', '.12345678.tmp')), raw, { mode: 0o600 });
  rmSync(join(worker.outbox.directory, filename));
  const recovered = fixture(stateDir);
  assert.deepEqual(await recovered.worker.drainCompletions(), { pending: 0, blocked: false });
  assert.deepEqual(readdirSync(worker.outbox.directory), []);
  assert.equal(recovered.calls.generated, 0);
});


test('an interrupted partial rewrite does not block its intact committed result', async (t) => {
  const stateDir = stateDirectory(t);
  const first = fixture(stateDir);
  first.worker.outbox.persist(completionEntry(claim, output, usage, first.api));
  const [filename] = readdirSync(first.worker.outbox.directory);
  writeFileSync(join(first.worker.outbox.directory, filename.replace('.json', '.00000000.tmp')), '{"version":1,', { mode: 0o600 });
  const recovered = fixture(stateDir);
  assert.deepEqual(await recovered.worker.drainCompletions(), { pending: 0, blocked: false });
  assert.deepEqual(readdirSync(first.worker.outbox.directory), []);
  assert.equal(recovered.calls.generated, 0);
  assert.equal(recovered.calls.fail, 0);
});

test('a partial temporary without a committed result is preserved and fails closed', async (t) => {
  const stateDir = stateDirectory(t);
  const { worker, calls } = fixture(stateDir);
  worker.outbox.ensureDirectory();
  const filename = `${'a'.repeat(64)}.00000000.tmp`;
  writeFileSync(join(worker.outbox.directory, filename), '{"version":1,', { mode: 0o600 });
  assert.deepEqual(await worker.drainCompletions(), { pending: 0, blocked: true });
  assert.equal((await worker.runClaim(claim)).status, 'PERSISTENCE_PENDING');
  assert.equal(calls.generated, 0);
  assert.deepEqual(readdirSync(worker.outbox.directory), [filename]);
});

test('a complete conflicting temporary never overwrites the committed result or its usage', async (t) => {
  const stateDir = stateDirectory(t);
  const first = fixture(stateDir);
  const entry = completionEntry(claim, output, usage, first.api);
  first.worker.outbox.persist(entry);
  const [filename] = readdirSync(first.worker.outbox.directory);
  const conflicting = { ...entry, usage: { ...usage, total_tokens: 999 } };
  writeFileSync(join(first.worker.outbox.directory, filename.replace('.json', '.00000000.tmp')), JSON.stringify(conflicting), { mode: 0o600 });
  const recovered = fixture(stateDir);
  assert.deepEqual(await recovered.worker.drainCompletions(), { pending: 1, blocked: true });
  assert.deepEqual(JSON.parse(readFileSync(join(first.worker.outbox.directory, filename), 'utf8')), entry);
  assert.equal(recovered.calls.complete.length, 0);
  assert.equal(recovered.calls.generated, 0);
  assert.equal(readdirSync(first.worker.outbox.directory).length, 2);
});
