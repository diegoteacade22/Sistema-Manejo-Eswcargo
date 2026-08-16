import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { CompanyOsApiClient } from '../src/api-client.mjs';
import { OpenAiAdvisoryClient } from '../src/openai-client.mjs';
import { OpenClawTelegramClient } from '../src/notification-client.mjs';
import { redactExternalValue } from '../src/redaction.mjs';
import { createWebhookServer } from '../src/server.mjs';
import { signatureFor, signedHeaders, verifySignedBody } from '../src/signing.mjs';
import { CompanyOsWorker, SerialWebhookQueue } from '../src/worker.mjs';

const claim = {
  leaseToken: 'lease-1',
  requestId: 'request-1',
  caseId: 'case-1',
  agentId: 'general-manager-ai-v3',
  objective: 'Identify the primary data quality problem',
  evidencePayload: { refs: [{ id: 'E-1', fact: 'Missing source owner' }] },
};

const advisory = {
  summary: 'Evidence needs an owner.',
  primaryDataQualityProblem: 'Source ownership is missing.',
  evidenceRefs: ['E-1'],
  recommendedNextStep: 'Ask the authorized owner to confirm the source.',
  missions: [{ title: 'Confirm source', objective: 'Obtain human confirmation', evidenceRefs: ['E-1'], status: 'PLANNED' }],
};

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

test('recover 204 termina sin llamar OpenAI', async () => {
  let openAiCalls = 0;
  const worker = new CompanyOsWorker({
    api: { claim: async (requestId) => { assert.equal(requestId, undefined); return null; } },
    openai: { generate: async () => { openAiCalls += 1; } },
  });

  assert.deepEqual(await worker.runOnce(undefined), { status: 'NO_CONTENT' });
  assert.equal(openAiCalls, 0);
});

test('redacción externa cubre credenciales conocidas antes de Telegram', () => {
  const value = redactExternalValue({ summary: 'ghp_abcdefghijklmnopqrstuvwxyz123456 AKIAABCDEFGHIJKLMNOP 123456789:abcdefghijklmnopqrstuvwxyzABCDE eyJabcdefghijk.eyJabcdefghijk.abcdefghijklmno' });
  assert.doesNotMatch(value.summary, /ghp_|AKIA|123456789:|eyJ/);
  assert.match(value.summary, /REDACTED/);
});

test('firma exacta timestamp.rawBody, rechaza firma alterada y timestamp viejo', () => {
  const nowMs = 1_800_000_000_000;
  const timestamp = String(Math.floor(nowMs / 1000));
  const rawBody = '{"requestId":"r-1"}';
  const signature = `sha256=${signatureFor('secret', timestamp, rawBody)}`;
  assert.equal(verifySignedBody({ secret: 'secret', timestamp, signature, rawBody, nowMs }), true);
  assert.equal(verifySignedBody({ secret: 'secret', timestamp, signature, rawBody: `${rawBody} `, nowMs }), false);
  assert.equal(verifySignedBody({ secret: 'secret', timestamp, signature, rawBody, nowMs: nowMs + 300_001 }), false);
});

test('cliente API firma todas las llamadas salientes sobre el body exacto', async () => {
  const requests = [];
  const nowMs = 1_800_000_000_000;
  const api = new CompanyOsApiClient({
    baseUrl: 'https://manager.example',
    hmacSecret: 'secret',
    now: () => nowMs,
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return jsonResponse({ ok: true });
    },
  });
  await api.heartbeat(claim);
  const request = requests[0];
  const expected = signedHeaders('secret', request.init.body, nowMs);
  assert.equal(request.init.headers['x-company-os-timestamp'], expected['x-company-os-timestamp']);
  assert.equal(request.init.headers['x-company-os-signature'], expected['x-company-os-signature']);
});

test('OpenAI hace como máximo un reintento', async () => {
  let calls = 0;
  const openai = new OpenAiAdvisoryClient({
    apiKey: 'test-key',
    timeoutMs: 1000,
    sleep: async () => {},
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({ error: 'temporary' }, 500);
    },
  });
  await assert.rejects(() => openai.generate(claim), /HTTP 500/);
  assert.equal(calls, 2);
});

test('Responses API usa el contrato V3 estricto y advisory', async () => {
  let requestBody;
  const usage = { input_tokens: 1, output_tokens: 2, total_tokens: 3 };
  const openai = new OpenAiAdvisoryClient({
    apiKey: 'test-key',
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return jsonResponse({ output_text: JSON.stringify(advisory), usage });
    },
  });
  const result = await openai.generate(claim);
  assert.equal(requestBody.model, 'gpt-5.6-sol');
  assert.equal(requestBody.store, false);
  assert.deepEqual(requestBody.reasoning, { effort: 'low' });
  assert.equal(requestBody.max_output_tokens, 3000);
  assert.equal(requestBody.text.format.type, 'json_schema');
  assert.equal(requestBody.text.format.strict, true);
  assert.equal(requestBody.text.format.schema.properties.missions.items.properties.status.enum[0], 'PLANNED');
  assert.deepEqual(requestBody.text.format.schema.properties.evidenceRefs.items.enum, ['refs']);
  assert.deepEqual(requestBody.text.format.schema.properties.missions.items.properties.evidenceRefs.items.enum, ['refs']);
  assert.deepEqual(result.output, advisory);
  assert.equal(result.usage.input_tokens, 1);
  assert.equal(result.usage.retry_count, 0);
  assert.ok(result.usage.snapshot_bytes > 0);
  assert.deepEqual(result.usage.rules_applied, ['general-manager-ai-v3','closed-evidence-only','advisory-only']);
});

test('cliente API conserva el motivo seguro de un rechazo', async () => {
  const api = new CompanyOsApiClient({
    baseUrl: 'https://manager.example', hmacSecret: 'secret',
    fetchImpl: async () => jsonResponse({ error: 'referencia no materializada' }, 409),
  });
  await assert.rejects(() => api.complete(claim, advisory, { total_tokens: 3 }), /referencia no materializada/);
});

test('webhook válido deduplica requestId en memoria y llama claim una sola vez', async (t) => {
  let claims = 0;
  const worker = { runOnce: async (requestId) => { claims += 1; assert.equal(requestId, 'request-1'); } };
  const queue = new SerialWebhookQueue({ worker });
  const server = createWebhookServer({ queue, hmacSecret: 'secret' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address();
  const rawBody = JSON.stringify({ requestId: 'request-1' });
  const headers = { 'content-type': 'application/json', ...signedHeaders('secret', rawBody) };

  const first = await fetch(`http://127.0.0.1:${port}/webhook`, { method: 'POST', headers, body: rawBody });
  const second = await fetch(`http://127.0.0.1:${port}/webhook`, { method: 'POST', headers, body: rawBody });
  assert.equal(first.status, 202);
  assert.equal(second.status, 202);
  assert.equal((await first.json()).deduped, false);
  assert.equal((await second.json()).deduped, true);
  await queue.idle();
  assert.equal(claims, 1);
});

test('health identifica servicio y contrato exactos', async (t) => {
  const server = createWebhookServer({ queue: { enqueue() {} }, hmacSecret: 'secret' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: 'company-os-v3-worker', contract: 'systems-manager-ai-v1', version: 1 });
});

test('webhook rechaza firma inválida sin encolar', async (t) => {
  let enqueued = 0;
  const server = createWebhookServer({
    queue: { enqueue: () => { enqueued += 1; } },
    hmacSecret: 'secret',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-company-os-timestamp': String(Math.floor(Date.now() / 1000)),
      'x-company-os-signature': `sha256=${'0'.repeat(64)}`,
    },
    body: JSON.stringify({ requestId: 'request-1' }),
  });
  assert.equal(response.status, 401);
  assert.equal(enqueued, 0);
});

test('propaga usage completa al endpoint complete', async () => {
  const usage = { input_tokens: 10, output_tokens: 20, total_tokens: 30, input_tokens_details: { cached_tokens: 4 } };
  let completed;
  const worker = new CompanyOsWorker({
    api: {
      claim: async () => claim,
      heartbeat: async () => ({}),
      complete: async (...args) => { completed = args; return { ok: true }; },
      fail: async () => { throw new Error('fail should not be called'); },
    },
    openai: { generate: async () => ({ output: advisory, usage }) },
    heartbeatIntervalMs: 1000,
  });
  assert.equal((await worker.runOnce('request-1')).status, 'COMPLETED');
  assert.deepEqual(completed, [claim, advisory, usage]);
});

test('notifica Telegram después de persistir complete y registra la entrega', async () => {
  const calls = [];
  const worker = new CompanyOsWorker({
    api: {
      claim: async () => claim,
      heartbeat: async () => ({}),
      complete: async () => { calls.push('complete'); },
      prepareNotification: async () => { calls.push('reserve'); return { send: true, reservationId: 'notification-1' }; },
      notification: async (_claim, reservationId, delivery) => { assert.equal(reservationId, 'notification-1'); calls.push(`notification:${delivery.status}`); },
      fail: async () => { throw new Error('fail should not be called'); },
    },
    openai: { generate: async () => ({ output: advisory, usage: { total_tokens: 3 } }) },
    notifier: { send: async () => { calls.push('telegram'); return { status: 'DELIVERED', responseCode: 200 }; } },
  });
  assert.equal((await worker.runOnce(claim.requestId)).status, 'COMPLETED');
  assert.deepEqual(calls, ['complete', 'reserve', 'telegram', 'notification:DELIVERED']);
});

test('cliente OpenClaw usa tools/invoke con Telegram y clave idempotente', async () => {
  let request;
  const notifier = new OpenClawTelegramClient({
    gatewayUrl: 'http://openclaw.local', gatewayToken: 'gateway-secret', target: '12345', botToken: 'bot-secret',
    fetchImpl: async (url, init) => { request = { url, init }; return jsonResponse({ ok: true }); },
  });
  await notifier.send(claim, advisory);
  const body = JSON.parse(request.init.body);
  assert.equal(request.url, 'http://openclaw.local/tools/invoke');
  assert.equal(body.tool, 'message');
  assert.equal(body.action, 'send');
  assert.equal(body.args.channel, 'telegram');
  assert.equal(body.args.to, '12345');
  assert.equal(body.args.idempotencyKey, 'company-os-v3:general-manager-ai-v3:request-1:completed');
});

test('Gerente de Sistemas usa IDs materializados y máximo cinco riesgos', async () => {
  let body;
  const systemsClaim = { ...claim, agentId: 'systems-manager-ai-v1', evidencePayload: {
    assets: [{ assetId: 'worker-1' }],
    risks: [{ riskId: 'risk-1', classification: 'ACTION_REQUIRED' }],
    coverage: { unobserved: ['backups'] },
  } };
  const output = {
    summary: 'Inventario listo.',
    primaryConfirmedRisk: 'Worker único.',
    primaryCoverageGap: 'Backups sin observar.',
    confirmedRiskNextStep: 'Validar recuperación.',
    coverageGapNextStep: 'Conectar metadatos read-only.',
    evidenceRefs: ['assets','risks','coverage'],
    actionableRisks: [{ riskId: 'risk-1', title: 'Worker único', assetId: 'worker-1', classification: 'ACTION_REQUIRED', priority: 78, evidenceRefs: ['risks'] }],
    missions: [{ title: 'Validar recuperación', objective: 'Prueba humana sin cambios.', evidenceRefs: ['risks'], status: 'PLANNED' }],
  };
  const openai = new OpenAiAdvisoryClient({ apiKey: 'test-key', fetchImpl: async (_url, init) => {
    body = JSON.parse(init.body);
    return jsonResponse({ output_text: JSON.stringify(output), usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 } });
  }});
  assert.deepEqual((await openai.generate(systemsClaim)).output, output);
  assert.deepEqual(body.text.format.schema.properties.actionableRisks.items.properties.assetId.enum, ['worker-1']);
  assert.deepEqual(body.text.format.schema.properties.actionableRisks.items.properties.riskId.enum, ['risk-1']);
  assert.equal(body.text.format.schema.properties.actionableRisks.maxItems, 5);
  assert.match(body.input[0].content, /systems-manager-ai-v1/);
});

test('agenda genérica usa API HMAC firmada', async () => {
  let request;
  const api = new CompanyOsApiClient({ baseUrl: 'https://manager.example', hmacSecret: 'secret', fetchImpl: async (url, init) => {
    request = { url, init }; return jsonResponse({ accepted: true, runs: [] });
  }});
  await api.schedule();
  assert.match(request.url, /\/worker\/schedule$/);
  assert.equal(request.init.body, '{}');
  assert.ok(request.init.headers['x-company-os-signature']);
});

test('Telegram falla cerrado sin bypass directo si OpenClaw falla', async () => {
  const calls = [];
  const notifier = new OpenClawTelegramClient({
    gatewayUrl: 'http://openclaw.local', gatewayToken: 'gateway-secret', target: '12345', botToken: 'bot-secret',
    fetchImpl: async (url) => {
      calls.push(url);
      return jsonResponse({ ok: false }, 500);
    },
  });
  await assert.rejects(() => notifier.send(claim, advisory), /OpenClaw notification HTTP 500/);
  assert.equal(calls.filter((url) => url.includes('/tools/invoke')).length, 2);
  assert.equal(calls.some((url) => url.includes('api.telegram.org')), false);
});
