import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { InstanceLock } from '../src/instance-lock.mjs';
import { JsonRotatingLogger } from '../src/json-logger.mjs';
import { OpenAiAdvisoryClient, OpenAiWorkerError, dataAdvisoryOutputSchemaFor, validateRuntimeContractOutput } from '../src/openai-client.mjs';
import {
  OllamaAdvisoryClient,
  localDecodingSchema,
  RetryableModelFallbackClient,
  validateOllamaBaseUrl,
} from '../src/ollama-client.mjs';
import { CompanyOsRuntimeApiClient } from '../src/runtime-api-client.mjs';
import { loadRuntimeConfig, validateRuntimeApiBaseUrl } from '../src/runtime-config.mjs';
import { CompanyOsRuntimeDaemon } from '../src/runtime-daemon.mjs';
import { createRuntimeHealthServer } from '../src/runtime-health.mjs';
import { buildDaemonRuntime } from '../src/server.mjs';
import {
  runtimeSignatureMessage,
  runtimeSignedHeaders,
  verifyRuntimeSignedBody,
} from '../src/runtime-signing.mjs';
import { CompanyOsWorker, safeFailure } from '../src/worker.mjs';

const silentLogger = {
  info() {},
  warn() {},
  error() {},
};

const runtimeOutputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'primaryDataQualityProblem', 'evidenceRefs', 'recommendedNextStep', 'missions', 'delegations', 'needsHumanDecision', 'confidence'],
  properties: {
    summary: { type: 'string', minLength: 1 },
    primaryDataQualityProblem: { type: 'string', minLength: 1 },
    evidenceRefs: { type: 'array', items: { type: 'string', minLength: 1 } },
    recommendedNextStep: { type: 'string', minLength: 1 },
    missions: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      required: ['title', 'objective', 'evidenceRefs', 'status'],
      properties: {
        title: { type: 'string' }, objective: { type: 'string', minLength: 1 },
        evidenceRefs: { type: 'array', items: { type: 'string', minLength: 1 } },
        status: { const: 'PLANNED' },
      },
    } },
    delegations: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      required: ['agentId', 'objective', 'evidenceRefs'],
      properties: {
        agentId: { const: 'systems-manager-ai-v1' },
        objective: { type: 'string', minLength: 1 },
        evidenceRefs: { type: 'array', items: { type: 'string', minLength: 1 } },
      },
    } },
    needsHumanDecision: { type: 'boolean' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

const runtimeOutput = {
  summary: 'Review complete.',
  primaryDataQualityProblem: 'Evidence needs ownership.',
  evidenceRefs: ['refs'],
  recommendedNextStep: 'Request human confirmation.',
  missions: [{ title: 'Confirm', objective: 'Confirm source ownership', evidenceRefs: ['refs'], status: 'PLANNED' }],
  delegations: [{ agentId: 'systems-manager-ai-v1', objective: 'Review technical coverage', evidenceRefs: ['refs'] }],
  needsHumanDecision: false,
  confidence: 0.9,
};

const claim = {
  leaseToken: 'lease-1',
  requestId: 'request-1',
  caseId: 'case-1',
  workItemId: 'work-1',
  attemptId: 'attempt-1',
  agentId: 'general-manager-ai-v3',
  objective: 'Review materialized evidence',
  evidencePayload: { refs: [{ id: 'E-1' }] },
  leaseExpiresAt: '2030-01-01T00:00:00.000Z',
  attempt: 1,
  slotNo: 1,
  handlerKey: 'general-manager-advisory',
  contractVersion: '3.1.1',
  contract: {
    advisoryOnly: true,
    lowConfidencePolicy: { minConfidence: 0.75 },
    outputSchema: runtimeOutputSchema,
  },
  contextMessages: [],
  budgets: { maxOutputTokens: 3_000, targetTotalTokens: 12_000 },
  timeoutMs: 120_000,
  advisoryOnly: true,
};

function tempDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), 'company-os-runtime-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function baseConfig(stateDir) {
  return {
    workerId: 'worker-test',
    hostName: 'mac-test',
    version: '1.0.0-test',
    stateDir,
    logDir: join(stateDir, 'logs'),
    healthHost: '127.0.0.1',
    healthPort: 0,
    pollIntervalMs: 60_000,
    workerHeartbeatIntervalMs: 60_000,
    reconcileIntervalMs: 60_000,
    scheduleIntervalMs: 60_000,
    globalConcurrency: 2,
    shutdownGraceMs: 50,
    allowedAgentIds: ['general-manager-ai-v3', 'systems-manager-ai-v1'],
    externalNotificationsEnabled: false,
  };
}

function fakeHealth() {
  return { listen: async () => ({ address: '127.0.0.1', port: 8794 }), close: async () => {} };
}

function fakeLock() {
  return { acquire() {}, release() {} };
}

function fakeApi(claims = []) {
  const calls = { claims: 0, failed: [], workerHeartbeats: [], heartbeats: 0, completed: 0, reconcile: 0, schedule: 0 };
  return {
    calls,
    async claim() { calls.claims += 1; return claims.length > 0 ? claims.shift() : null; },
    async fail(value, error) { calls.failed.push({ claim: value, error }); return { accepted: true }; },
    async heartbeat() { calls.heartbeats += 1; return { accepted: true }; },
    async complete() { calls.completed += 1; return { accepted: true }; },
    async workerHeartbeat(payload) { calls.workerHeartbeats.push(payload); return { accepted: true }; },
    async reconcile() { calls.reconcile += 1; return { accepted: true }; },
    async schedule() { calls.schedule += 1; return { accepted: true }; },
  };
}

function createDaemon({ stateDir, api, processor, sleep, config = {} }) {
  return new CompanyOsRuntimeDaemon({
    config: { ...baseConfig(stateDir), ...config },
    api,
    processor,
    logger: silentLogger,
    instanceId: 'instance-test',
    lock: fakeLock(),
    healthServerFactory: fakeHealth,
    ...(sleep ? { sleep } : {}),
  });
}

test('HMAC runtime v2 firma workerId, nonce, timestamp y body exactos', () => {
  const nowMs = 1_800_000_000_000;
  const timestamp = String(Math.floor(nowMs / 1000));
  const nonce = '0123456789abcdef';
  const rawBody = '{"workerId":"worker-test"}';
  assert.equal(runtimeSignatureMessage('worker-test', nonce, timestamp, rawBody), `worker-test.${nonce}.${timestamp}.${rawBody}`);
  const headers = runtimeSignedHeaders({ secret: 'runtime-secret', workerId: 'worker-test', nonce, rawBody, nowMs });
  assert.equal(headers['x-company-os-signature-version'], 'v2');
  assert.equal(headers['x-company-os-worker-id'], 'worker-test');
  assert.equal(headers['x-company-os-nonce'], nonce);
  assert.equal(verifyRuntimeSignedBody({
    secret: 'runtime-secret', workerId: 'worker-test', nonce, timestamp,
    signature: headers['x-company-os-signature'], rawBody, nowMs,
  }), true);
  assert.equal(verifyRuntimeSignedBody({
    secret: 'runtime-secret', workerId: 'worker-test', nonce, timestamp,
    signature: headers['x-company-os-signature'], rawBody: `${rawBody} `, nowMs,
  }), false);
  assert.equal(verifyRuntimeSignedBody({
    secret: 'runtime-secret', workerId: 'worker-test', nonce, timestamp,
    signature: headers['x-company-os-signature'], rawBody, nowMs: nowMs + 300_001,
  }), false);
  assert.notEqual(
    runtimeSignedHeaders({ secret: 'runtime-secret', workerId: 'worker-test', rawBody, nowMs })['x-company-os-nonce'],
    runtimeSignedHeaders({ secret: 'runtime-secret', workerId: 'worker-test', rawBody, nowMs })['x-company-os-nonce'],
  );
});

test('cliente runtime usa los siete endpoints, identidad estable y nonce único', async () => {
  const requests = [];
  let nonce = 0;
  const api = new CompanyOsRuntimeApiClient({
    baseUrl: 'https://runtime.example',
    hmacSecret: 'runtime-secret',
    workerId: 'worker-test',
    instanceId: 'instance-test',
    now: () => 1_800_000_000_000,
    nonceFactory: () => `nonce-${String(++nonce).padStart(16, '0')}`,
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return new Response(null, { status: 204 });
    },
  });
  await api.claim();
  await api.heartbeat(claim);
  await api.complete(claim, { summary: 'safe' }, { total_tokens: 3 });
  await api.fail(claim, { code: 'SAFE_FAILURE', message: 'safe', retryable: false });
  await api.workerHeartbeat({ state: 'IDLE' });
  await api.reconcile();
  await api.schedule();

  assert.deepEqual(requests.map(({ url }) => url.split('/').at(-1)), [
    'claim', 'heartbeat', 'complete', 'fail', 'worker-heartbeat', 'reconcile', 'schedule',
  ]);
  assert.equal(new Set(requests.map(({ init }) => init.headers['x-company-os-nonce'])).size, 7);
  for (const { init } of requests) {
    const body = JSON.parse(init.body);
    assert.equal(body.workerId, 'worker-test');
    assert.equal(body.instanceId, 'instance-test');
    assert.equal(init.redirect, 'error');
    assert.equal(verifyRuntimeSignedBody({
      secret: 'runtime-secret',
      workerId: init.headers['x-company-os-worker-id'],
      nonce: init.headers['x-company-os-nonce'],
      timestamp: init.headers['x-company-os-timestamp'],
      signature: init.headers['x-company-os-signature'],
      rawBody: init.body,
      nowMs: 1_800_000_000_000,
    }), true);
  }
  assert.deepEqual(JSON.parse(requests[0].init.body), { workerId: 'worker-test', instanceId: 'instance-test' });
  assert.equal(JSON.parse(requests[1].init.body).phase, 'RUNNING');
  assert.deepEqual(
    Object.fromEntries(Object.entries(JSON.parse(requests[3].init.body)).filter(([key]) => ['errorCode', 'detail', 'retryable'].includes(key))),
    { errorCode: 'SAFE_FAILURE', detail: 'safe', retryable: false },
  );
  assert.equal('error' in JSON.parse(requests[3].init.body), false);
});

test('runtime OpenAI usa contract.outputSchema y valida campos nuevos localmente', async () => {
  let requestBody;
  let requestHeaders;
  const openai = new OpenAiAdvisoryClient({
    apiKey: 'openai-test',
    requireClaimOutputSchema: true,
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(init.body);
      requestHeaders = init.headers;
      return new Response(JSON.stringify({
        id: 'response-1',
        output_text: JSON.stringify(runtimeOutput),
        usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const result = await openai.generate(claim);
  assert.deepEqual(requestBody.text.format.schema.properties.evidenceRefs.items.enum, ['refs']);
  assert.deepEqual(requestBody.text.format.schema.properties.missions.items.properties.evidenceRefs.items.enum, ['refs']);
  assert.deepEqual(requestBody.text.format.schema.properties.delegations.items.properties.evidenceRefs.items.enum, ['refs']);
  assert.equal(runtimeOutputSchema.properties.evidenceRefs.items.enum, undefined);
  assert.equal(requestHeaders['idempotency-key'], 'company-os-runtime:attempt-1');
  assert.equal(requestBody.text.format.strict, true);
  assert.equal(result.output.confidence, 0.9);
  assert.equal(result.output.needsHumanDecision, false);
  assert.equal(result.output.delegations[0].agentId, 'systems-manager-ai-v1');
  assert.match(result.usage.rules_applied[0], /general-manager-ai-v3@3\.1\.1/);
});

test('Ollama usa sólo loopback, JSON schema firmado y reporta usage local honesta', async () => {
  let request;
  const ollama = new OllamaAdvisoryClient({
    baseUrl: 'http://127.0.0.1:11434',
    model: 'qwen3:14b-q4_K_M',
    timeoutMs: 1_000,
    requireClaimOutputSchema: true,
    fetchImpl: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({
        model: 'qwen3:14b-q4_K_M',
        done: true,
        message: { role: 'assistant', content: JSON.stringify(runtimeOutput) },
        prompt_eval_count: 111,
        eval_count: 37,
        total_duration: 1_500_000_000,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  const result = await ollama.generate(claim);
  const body = JSON.parse(request.init.body);
  assert.equal(request.url, 'http://127.0.0.1:11434/api/chat');
  assert.equal(request.init.redirect, 'error');
  assert.equal(body.model, 'qwen3:14b-q4_K_M');
  assert.equal(body.stream, false);
  assert.equal(body.think, false);
  assert.equal(body.options.temperature, 0);
  assert.equal(body.options.num_predict, 3_000);
  assert.deepEqual(body.format.properties.evidenceRefs.items.enum, ['refs']);
  assert.deepEqual(result.output, runtimeOutput);
  assert.equal(result.usage.provider, 'ollama');
  assert.equal(result.usage.model, 'qwen3:14b-q4_K_M');
  assert.equal(result.usage.input_tokens, 111);
  assert.equal(result.usage.output_tokens, 37);
  assert.equal(result.usage.total_tokens, 148);
  assert.equal(result.usage.duration_ms, 1_500);
  assert.match(result.usage.rules_applied.join(','), /signed-runtime-contract/);
  assert.match(result.usage.rules_applied.join(','), /local-loopback-inference/);
});

test('Data Manager usa exclusivamente Ollama local y su esquema estricto', async () => {
  const dataOutput = {
    summary: 'Calidad observada.',
    primaryDataQualityProblem: 'Cobertura parcial.',
    primaryFreshnessGap: 'Sin sincronización reciente.',
    recommendedNextStep: 'Revisar la fuente.',
    evidenceRefs: ['refs'],
    dataFindings: [{ findingId: 'f-1', title: 'Cobertura', classification: 'REVIEW', priority: 70, evidenceRefs: ['refs'] }],
    missions: [],
    needsHumanDecision: false,
    confidence: 0.9,
  };
  const dataClaim = {
    ...claim,
    agentId: 'data-manager-ai-v1',
    handlerKey: 'data-manager-advisory',
    contractVersion: '1.0.0',
    contract: {
      ...claim.contract,
      agentId: 'data-manager-ai-v1',
      handlerKey: 'data-manager-advisory',
      version: '1.0.0',
      outputSchema: dataAdvisoryOutputSchemaFor({ refs: [{ id: 'e-1' }] }),
    },
    evidencePayload: { refs: [{ id: 'e-1' }] },
  };
  let localRequest = null;
  const ollama = new OllamaAdvisoryClient({
    baseUrl: 'http://127.0.0.1:11434',
    model: 'qwen3:14b-q4_K_M',
    requireClaimOutputSchema: true,
    fetchImpl: async (url, init) => {
      localRequest = { url, init };
      return new Response(JSON.stringify({ model: 'qwen3:14b-q4_K_M', done: true, message: { content: JSON.stringify(dataOutput) }, prompt_eval_count: 10, eval_count: 5 }), { status: 200 });
    },
  });
  const result = await ollama.generate(dataClaim);
  const body = JSON.parse(localRequest.init.body);
  assert.equal(localRequest.url, 'http://127.0.0.1:11434/api/chat');
  assert.deepEqual(body.format.properties.dataFindings.items.properties.evidenceRefs.items.enum, ['refs']);
  assert.deepEqual(result.output, dataOutput);
});

test('OpenAI rechaza Data Manager antes de cualquier egress', async () => {
  let calls = 0;
  const client = new OpenAiAdvisoryClient({
    apiKey: 'test-key',
    requireClaimOutputSchema: true,
    fetchImpl: async () => { calls += 1; return new Response('{}', { status: 200 }); },
  });
  await assert.rejects(() => client.generate({ ...claim, agentId: 'data-manager-ai-v1' }), (error) => error.code === 'OPENAI_DATA_EXPORT_DISABLED');
  assert.equal(calls, 0);
});

test('Ollama exige model exacto y done=true antes de atribuir usage', async () => {
  const cases = [
    {
      raw: {
        done: true,
        message: { role: 'assistant', content: JSON.stringify(runtimeOutput) },
        prompt_eval_count: 20,
        eval_count: 5,
      },
      code: 'OLLAMA_MODEL_MISMATCH',
    },
    {
      raw: {
        model: 'qwen3:14b-q4_K_M',
        done: false,
        message: { role: 'assistant', content: JSON.stringify(runtimeOutput) },
        prompt_eval_count: 20,
        eval_count: 5,
      },
      code: 'OLLAMA_INCOMPLETE_RESPONSE',
    },
  ];

  for (const { raw, code } of cases) {
    const ollama = new OllamaAdvisoryClient({
      fetchImpl: async () => new Response(JSON.stringify(raw), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    });
    await assert.rejects(
      () => ollama.generate(claim),
      (error) => error.code === code && error.usage === undefined,
    );
  }
});

test('Ollama bloquea redirects HTTP sin efectuar un segundo fetch', async () => {
  let fetchCalls = 0;
  let redirectMode = null;
  const ollama = new OllamaAdvisoryClient({
    fetchImpl: async (_url, init) => {
      fetchCalls += 1;
      redirectMode = init.redirect;
      return new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1:11434/redirected' },
      });
    },
  });
  await assert.rejects(
    () => ollama.generate(claim),
    (error) => error.code === 'OLLAMA_HTTP_ERROR' && error.status === 302 && error.retryable === false,
  );
  assert.equal(redirectMode, 'error');
  assert.equal(fetchCalls, 1);
});

test('Ollama rechaza endpoints no-loopback y vuelve a validar la salida con el contrato runtime', async () => {
  assert.equal(validateOllamaBaseUrl('http://127.0.0.1:11434'), 'http://127.0.0.1:11434');
  assert.equal(validateOllamaBaseUrl('http://[::1]:11434'), 'http://[::1]:11434');
  assert.throws(() => validateOllamaBaseUrl('http://localhost:11434'), /loopback/);
  assert.throws(() => validateOllamaBaseUrl('https://127.0.0.1:11434'), /loopback/);
  assert.throws(() => validateOllamaBaseUrl('http://127.0.0.1:11434/api'), /loopback/);
  assert.throws(() => validateOllamaBaseUrl('http://192.168.1.10:11434'), /loopback/);

  const invalid = { ...runtimeOutput, evidenceRefs: ['outside-snapshot'] };
  const ollama = new OllamaAdvisoryClient({
    fetchImpl: async () => new Response(JSON.stringify({
      model: 'qwen3:14b-q4_K_M',
      done: true,
      message: { role: 'assistant', content: JSON.stringify(invalid) },
      prompt_eval_count: 20,
      eval_count: 5,
    }), { status: 200, headers: { 'content-type': 'application/json' } }),
  });
  await assert.rejects(
    () => ollama.generate(claim),
    (error) => error.code === 'OLLAMA_INVALID_RUNTIME_OUTPUT' && error.usage?.provider === 'ollama'
      && error.cause?.code === 'OPENAI_INVALID_RUNTIME_OUTPUT',
  );
});

test('fallback llama Qwen sólo después de agotar un error OpenAI permitido', async () => {
  let openAiCalls = 0;
  let ollamaCalls = 0;
  const primary = new OpenAiAdvisoryClient({
    apiKey: 'test-key',
    timeoutMs: 1_000,
    requireClaimOutputSchema: true,
    sleep: async () => {},
    fetchImpl: async () => {
      openAiCalls += 1;
      return new Response(JSON.stringify({ error: 'rate limited' }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  const client = new RetryableModelFallbackClient({
    primary,
    fallback: {
      generate: async () => {
        ollamaCalls += 1;
        return { output: runtimeOutput, usage: { provider: 'ollama', model: 'qwen3:14b-q4_K_M', retry_count: 0 } };
      },
    },
  });

  const result = await client.generate(claim);
  assert.equal(openAiCalls, 2);
  assert.equal(ollamaCalls, 1);
  assert.equal(result.usage.provider, 'ollama');
  assert.equal(result.usage.retry_count, 2);
  assert.equal(result.usage.fallback_from_provider, 'openai');
  assert.equal(result.usage.fallback_reason, 'OPENAI_HTTP_ERROR');
});

test('fallback reserva su slice dentro del deadline absoluto y persiste latencia end-to-end', async () => {
  let clock = 1_800_000_000_000;
  let fallbackDeadline = null;
  const primaryError = new OpenAiWorkerError('rate limited', {
    retryable: true, code: 'OPENAI_HTTP_ERROR', status: 429,
  });
  primaryError.retryCount = 1;
  const client = new RetryableModelFallbackClient({
    now: () => clock,
    primary: {
      generate: async (_claim, options) => {
        assert.equal(options.deadlineAt, 1_800_000_090_000);
        clock += 75_000;
        throw primaryError;
      },
    },
    fallback: {
      generate: async (_claim, options) => {
        fallbackDeadline = options.deadlineAt;
        clock += 20_000;
        return { output: runtimeOutput, usage: { provider: 'ollama', model: 'qwen3:14b-q4_K_M', duration_ms: 20_000 } };
      },
    },
  });
  const result = await client.generate({ ...claim, timeoutMs: 120_000 });
  assert.equal(fallbackDeadline, 1_800_000_120_000);
  assert.equal(result.usage.duration_ms, 95_000);
  assert.equal(result.usage.fallback_provider_duration_ms, 20_000);
});

test('OpenAI colgado vence en su slice y Qwen termina dentro del deadline total', async () => {
  let primaryDeadline = null;
  let fallbackDeadline = null;
  const primary = new OpenAiAdvisoryClient({
    apiKey: 'test-key',
    timeoutMs: 1_000,
    requireClaimOutputSchema: true,
    sleep: async () => {},
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      const abort = () => {
        const error = new Error('hung OpenAI request timed out');
        error.name = 'AbortError';
        reject(error);
      };
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    }),
  });
  const router = new RetryableModelFallbackClient({
    fallbackReserveMs: 750,
    primary: {
      generate: async (value, options) => {
        primaryDeadline = options.deadlineAt;
        return primary.generate(value, options);
      },
    },
    fallback: {
      generate: async (_value, options) => {
        fallbackDeadline = options.deadlineAt;
        return {
          output: runtimeOutput,
          usage: { provider: 'ollama', model: 'qwen3:14b-q4_K_M', duration_ms: 1 },
        };
      },
    },
  });

  const wallStartedAt = Date.now();
  const result = await router.generate({ ...claim, timeoutMs: 1_000 });
  const elapsedMs = Date.now() - wallStartedAt;
  assert.ok(primaryDeadline - wallStartedAt <= 510);
  assert.ok(fallbackDeadline - primaryDeadline >= 490);
  assert.ok(elapsedMs < 1_000);
  assert.equal(result.usage.provider, 'ollama');
  assert.equal(result.usage.fallback_reason, 'OPENAI_TIMEOUT');
});

test('fallo compuesto conserva retryable del primario aunque Qwen falle schema cerrado', async () => {
  const primaryError = new OpenAiWorkerError('OpenAI unavailable', {
    retryable: true,
    code: 'OPENAI_NETWORK_ERROR',
  });
  primaryError.retryCount = 1;
  const fallback = new OllamaAdvisoryClient({
    fetchImpl: async () => new Response(JSON.stringify({
      model: 'qwen3:14b-q4_K_M',
      done: true,
      message: { role: 'assistant', content: JSON.stringify({ ...runtimeOutput, evidenceRefs: ['forged'] }) },
      prompt_eval_count: 20,
      eval_count: 5,
    }), { status: 200, headers: { 'content-type': 'application/json' } }),
  });
  const router = new RetryableModelFallbackClient({
    primary: { generate: async () => { throw primaryError; } },
    fallback,
  });

  await assert.rejects(
    () => router.generate(claim),
    (error) => error.code === 'MODEL_ROUTER_FALLBACK_FAILED'
      && error.primaryCode === 'OPENAI_NETWORK_ERROR'
      && error.fallbackCode === 'OLLAMA_INVALID_RUNTIME_OUTPUT'
      && error.retryable === true
      && safeFailure(error).retryable === true,
  );
});

test('OpenAI 429 agotado más timeout Ollama emite fallo compuesto y degrada ambos providers', async (t) => {
  let openAiCalls = 0;
  const primary = new OpenAiAdvisoryClient({
    apiKey: 'test-key',
    timeoutMs: 1_000,
    requireClaimOutputSchema: true,
    sleep: async () => {},
    fetchImpl: async () => {
      openAiCalls += 1;
      return new Response(JSON.stringify({ error: 'rate limited' }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  const fallback = new OllamaAdvisoryClient({
    timeoutMs: 5,
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      const abort = () => {
        const error = new Error('local timeout');
        error.name = 'AbortError';
        reject(error);
      };
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    }),
  });
  const router = new RetryableModelFallbackClient({ primary, fallback });
  let composed;
  await assert.rejects(
    () => router.generate(claim),
    (error) => {
      composed = error;
      return error.code === 'MODEL_ROUTER_FALLBACK_FAILED';
    },
  );
  assert.equal(openAiCalls, 2);
  assert.equal(composed.primaryCode, 'OPENAI_HTTP_ERROR');
  assert.equal(composed.fallbackCode, 'OLLAMA_TIMEOUT');
  assert.equal(composed.retries, 2);
  assert.ok(composed.durationMs >= 0);
  assert.equal(composed.usage.provider, 'ollama');
  assert.equal(composed.usage.retry_count, 2);
  assert.equal(composed.usage.duration_ms, composed.durationMs);

  const emitted = safeFailure(composed);
  assert.deepEqual(emitted, {
    code: 'MODEL_ROUTER_FALLBACK_FAILED',
    message: 'Model router fallback failed: primary=OPENAI_HTTP_ERROR; fallback=OLLAMA_TIMEOUT',
    retryable: true,
    primaryCode: 'OPENAI_HTTP_ERROR',
    fallbackCode: 'OLLAMA_TIMEOUT',
    retries: 2,
    durationMs: composed.durationMs,
  });
  const daemon = createDaemon({ stateDir: tempDirectory(t), api: fakeApi([]), processor: { runClaim: async () => ({}) } });
  daemon.starting = false;
  daemon.observeModelResult({ status: 'FAILED', error: emitted });
  const dependencies = daemon.heartbeatPayload().dependencies;
  assert.equal(dependencies.find(({ key }) => key === 'inference-router').status, 'DEGRADED');
  assert.deepEqual(
    dependencies.filter(({ key }) => ['openai-api', 'ollama-local'].includes(key)).map(({ key, status, detail }) => ({ key, status, detail })),
    [
      { key: 'openai-api', status: 'DEGRADED', detail: 'OPENAI_HTTP_ERROR' },
      { key: 'ollama-local', status: 'DEGRADED', detail: 'OLLAMA_TIMEOUT' },
    ],
  );
});

test('fallback no oculta errores OpenAI no elegibles aunque sean marcados retryable', async () => {
  let fallbackCalls = 0;
  const conflict = new OpenAiWorkerError('conflict', {
    retryable: true,
    code: 'OPENAI_HTTP_ERROR',
    status: 409,
  });
  const client = new RetryableModelFallbackClient({
    primary: { generate: async () => { throw conflict; } },
    fallback: { generate: async () => { fallbackCalls += 1; } },
  });
  await assert.rejects(() => client.generate(claim), (error) => error === conflict);
  assert.equal(fallbackCalls, 0);
});

test('runtime OpenAI falla cerrado sin schema y con baja confianza no escalada', async () => {
  let fetchCalls = 0;
  const openai = new OpenAiAdvisoryClient({
    apiKey: 'openai-test',
    requireClaimOutputSchema: true,
    fetchImpl: async () => { fetchCalls += 1; throw new Error('must not fetch'); },
  });
  await assert.rejects(() => openai.generate({ ...claim, contract: { ...claim.contract, outputSchema: undefined } }), (error) => error.code === 'RUNTIME_OUTPUT_SCHEMA_REQUIRED');
  assert.equal(fetchCalls, 0);
  assert.throws(
    () => validateRuntimeContractOutput(claim, { ...runtimeOutput, confidence: 0.4, needsHumanDecision: false }),
    /low confidence must require a human decision/,
  );
  assert.throws(
    () => validateRuntimeContractOutput(claim, { ...runtimeOutput, evidenceRefs: ['outside-snapshot'] }),
    /enum|outside the closed snapshot/,
  );
});

test('procesador runtime no llama OpenAI cuando el lease inicial no renueva', async () => {
  let modelCalls = 0;
  let failed;
  const processor = new CompanyOsWorker({
    api: {
      heartbeat: async () => { throw Object.assign(new Error('Lease rejected'), { code: 'LEASE_REJECTED' }); },
      fail: async (_claim, error) => { failed = error; },
    },
    openai: { generate: async () => { modelCalls += 1; } },
    failClosedInitialHeartbeat: true,
  });
  const result = await processor.runClaim(claim);
  assert.equal(result.status, 'FAILED');
  assert.equal(result.error.code, 'LEASE_HEARTBEAT_FAILED');
  assert.equal(failed.code, 'LEASE_HEARTBEAT_FAILED');
  assert.equal(modelCalls, 0);
});

test('pérdida de heartbeat aborta el modelo activo y reporta el lease como reintentable', async () => {
  let heartbeatCalls = 0;
  let modelCalls = 0;
  let failed;
  const processor = new CompanyOsWorker({
    api: {
      heartbeat: async () => {
        heartbeatCalls += 1;
        if (heartbeatCalls > 1) throw Object.assign(new Error('Lease cancelled'), { code: 'LEASE_CANCELLED' });
      },
      fail: async (_claim, error) => { failed = error; },
    },
    openai: {
      generate: async (_claim, { signal }) => {
        modelCalls += 1;
        return new Promise((_resolve, reject) => signal.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        }, { once: true }));
      },
    },
    heartbeatIntervalMs: 1,
    failClosedInitialHeartbeat: true,
  });
  const result = await processor.runClaim(claim);
  assert.equal(result.status, 'FAILED');
  assert.equal(result.error.code, 'LEASE_HEARTBEAT_FAILED');
  assert.equal(result.error.retryable, true);
  assert.equal(failed.code, 'LEASE_HEARTBEAT_FAILED');
  assert.equal(modelCalls, 1);
  assert.ok(heartbeatCalls >= 2);
});

test('config runtime fija intervalos, concurrencia, health local y notificaciones apagadas', () => {
  const config = loadRuntimeConfig({
    COMPANY_OS_RUNTIME_HMAC_SECRET: 'runtime-secret',
    COMPANY_OS_EXTERNAL_IDENTITY_HMAC_SECRET: 'external-identity-secret',
    OPENAI_API_KEY: 'openai-test',
  });
  assert.equal(config.pollIntervalMs, 15_000);
  assert.equal(config.workerHeartbeatIntervalMs, 60_000);
  assert.equal(config.reconcileIntervalMs, 60_000);
  assert.equal(config.scheduleIntervalMs, 60_000);
  assert.equal(config.globalConcurrency, 2);
  assert.equal(config.shutdownGraceMs, 30_000);
  assert.equal(config.healthHost, '127.0.0.1');
  assert.equal(config.healthPort, 8794);
  assert.equal(config.version, '1.1.0');
  assert.equal(config.binaryVersion, '1.1.0');
  assert.equal(config.contractVersion, 'runtime-v1');
  assert.equal(config.sourceRevision, null);
  assert.equal(config.externalNotificationsEnabled, false);
  assert.equal(config.ollamaFallbackEnabled, true);
  assert.equal(config.ollamaBaseUrl, 'http://127.0.0.1:11434');
  assert.equal(config.ollamaModel, 'qwen3:14b-q4_K_M');
  assert.equal(config.localLineageModel, 'qwen3:4b-q4_K_M');
  assert.throws(() => loadRuntimeConfig({
    COMPANY_OS_RUNTIME_HMAC_SECRET: 'runtime-secret', OPENAI_API_KEY: 'openai-test',
    COMPANY_OS_EXTERNAL_IDENTITY_HMAC_SECRET: 'external-identity-secret',
    COMPANY_OS_RUNTIME_LOCAL_LINEAGE_MODEL: 'qwen3:14b-q4_K_M',
  }), /allowlisted local model/);
  assert.throws(() => validateRuntimeApiBaseUrl('http://webapp-weld-psi.vercel.app'), /pure HTTPS origin/);
  assert.throws(() => validateRuntimeApiBaseUrl('https://webapp-weld-psi.vercel.app:8443'), /pure HTTPS origin/);
  assert.throws(() => validateRuntimeApiBaseUrl('https://attacker.example'), /not allowlisted/);
  assert.throws(() => loadRuntimeConfig({
    COMPANY_OS_RUNTIME_HMAC_SECRET: 'runtime-secret', OPENAI_API_KEY: 'openai-test',
    COMPANY_OS_EXTERNAL_IDENTITY_HMAC_SECRET: 'external-identity-secret',
    COMPANY_OS_RUNTIME_EXTERNAL_NOTIFICATIONS_ENABLED: 'true',
  }), /must remain false/);
  assert.throws(() => loadRuntimeConfig({
    COMPANY_OS_RUNTIME_HMAC_SECRET: 'runtime-secret', OPENAI_API_KEY: 'openai-test',
    COMPANY_OS_EXTERNAL_IDENTITY_HMAC_SECRET: 'external-identity-secret',
    COMPANY_OS_RUNTIME_SOURCE_REVISION: 'short-revision',
  }), /full Git commit/);
});

test('daemon runtime cablea el fallback Ollama sin habilitarlo como proveedor primario', (t) => {
  const stateDir = tempDirectory(t);
  const config = loadRuntimeConfig({
    COMPANY_OS_RUNTIME_HMAC_SECRET: 'runtime-secret',
    COMPANY_OS_EXTERNAL_IDENTITY_HMAC_SECRET: 'external-identity-secret',
    OPENAI_API_KEY: 'openai-test',
    COMPANY_OS_RUNTIME_STATE_DIR: stateDir,
  });
  const runtime = buildDaemonRuntime(config, {
    api: {},
    logger: silentLogger,
    instanceId: 'instance-fallback-test',
  });
  assert.ok(runtime.processor.openai instanceof RetryableModelFallbackClient);
  assert.ok(runtime.processor.openai.primary instanceof OpenAiAdvisoryClient);
  assert.ok(runtime.processor.openai.fallback instanceof OllamaAdvisoryClient);
  assert.equal(runtime.processor.openai.enabled, true);
  assert.equal(runtime.processor.openai.fallback.model, 'qwen3:14b-q4_K_M');
});

test('decoding local acota extensión sin mutar ni relajar el contrato ni recortar hallazgos', () => {
  const schema = dataAdvisoryOutputSchemaFor({ quality: {}, freshness: {} });
  const original = structuredClone(schema);
  const local = localDecodingSchema(schema, { quality: {}, freshness: {} });
  assert.deepEqual(schema, original);
  assert.equal(local.properties.summary.maxLength, 240);
  assert.equal(local.properties.dataFindings.maxItems, 10);
  assert.equal(local.properties.dataFindings.items.properties.title.maxLength, 120);
  assert.equal(local.properties.missions.maxItems, 10);
  assert.equal(local.properties.evidenceRefs.maxItems, 2);
  assert.deepEqual(local.required, schema.required);
  assert.deepEqual(local.properties.confidence, schema.properties.confidence);
  assert.deepEqual(local.properties.evidenceRefs.items.enum, ['quality', 'freshness']);
  const stricter = { type: 'object', properties: { summary: { type: 'string', maxLength: 20 }, missions: { type: 'array', maxItems: 1, items: { type: 'string' } } } };
  assert.equal(localDecodingSchema(stricter, {}).properties.summary.maxLength, 20);
  assert.equal(localDecodingSchema(stricter, {}).properties.missions.maxItems, 1);
});

test('Data y su retorno General usan Qwen4b sin cambiar fallback14b ni validación', async (t) => {
  const stateDir = tempDirectory(t);
  const config = loadRuntimeConfig({
    COMPANY_OS_RUNTIME_HMAC_SECRET: 'runtime-secret', OPENAI_API_KEY: 'openai-test',
    COMPANY_OS_EXTERNAL_IDENTITY_HMAC_SECRET: 'external-identity-secret',
    COMPANY_OS_RUNTIME_STATE_DIR: stateDir,
  });
  const dataOutput = {
    summary: 'Observación sintética.', primaryDataQualityProblem: 'Sin problemas observados.',
    primaryFreshnessGap: 'Sin brecha observada.', recommendedNextStep: 'Conservar observación.',
    evidenceRefs: ['refs'], dataFindings: [], missions: [], needsHumanDecision: false, confidence: 0.9,
  };
  const dataClaim = {
    ...claim, agentId: 'data-manager-ai-v1',
    contract: { ...claim.contract, outputSchema: dataAdvisoryOutputSchemaFor(claim.evidencePayload) },
  };
  const requests = [];
  const runtime = buildDaemonRuntime(config, {
    api: {}, logger: silentLogger,
    fetchImpl: async (url, init) => {
      assert.equal(url, 'http://127.0.0.1:11434/api/chat');
      const body = JSON.parse(init.body);
      requests.push(body);
      return new Response(JSON.stringify({
        model: body.model, done: true,
        message: { content: JSON.stringify(requests.length === 1 ? dataOutput : runtimeOutput) },
        prompt_eval_count: 30, eval_count: 20,
      }), { status: 200 });
    },
  });
  assert.deepEqual((await runtime.processor.openai.generate(dataClaim)).output, dataOutput);
  assert.deepEqual((await runtime.processor.openai.generate({
    ...claim, dataPolicy: { version: 1, inference: 'LOCAL_ONLY', reason: 'DATA_MANAGER_LINEAGE' },
  })).output, runtimeOutput);
  assert.equal(runtime.processor.openai.fallback.model, 'qwen3:14b-q4_K_M');
  for (const body of requests) {
    assert.equal(body.model, 'qwen3:4b-q4_K_M');
    assert.equal(body.think, false);
    assert.equal(body.options.num_predict, claim.budgets.maxOutputTokens);
    assert.match(body.messages.map(({ content }) => content).join(' '), /complete compact JSON object/);
    assert.equal(body.format.additionalProperties, false);
    assert.deepEqual(body.format.properties.evidenceRefs.items.enum, ['refs']);
  }
  const originalSchema = structuredClone(runtimeOutputSchema);
  const invalid = { ...runtimeOutput, confidence: 0.1, needsHumanDecision: false };
  assert.throws(() => validateRuntimeContractOutput(claim, invalid), /confidence/i);
  assert.deepEqual(runtimeOutputSchema, originalSchema);
});

test('queue vacía no invoca el procesador ni un modelo', async (t) => {
  const stateDir = tempDirectory(t);
  const api = fakeApi([]);
  let processorCalls = 0;
  const daemon = createDaemon({ stateDir, api, processor: { runClaim: async () => { processorCalls += 1; } } });
  await daemon.start({ runImmediately: false });
  assert.deepEqual(await daemon.tickPoll(), { claimed: 0, attempts: 1 });
  assert.equal(processorCalls, 0);
  assert.equal(daemon.snapshot().state, 'IDLE');
  await daemon.stop('TEST');
});

test('claim sin outputSchema se rechaza localmente sin invocar el modelo', async (t) => {
  const stateDir = tempDirectory(t);
  const api = fakeApi([{ ...claim, contract: { ...claim.contract, outputSchema: undefined } }]);
  let processorCalls = 0;
  const daemon = createDaemon({ stateDir, api, processor: { runClaim: async () => { processorCalls += 1; } } });
  await daemon.start({ runImmediately: false });
  assert.deepEqual(await daemon.tickPoll(), { claimed: 0, attempts: 2 });
  assert.equal(processorCalls, 0);
  assert.equal(api.calls.failed[0].error.code, 'RUNTIME_OUTPUT_SCHEMA_REQUIRED');
  assert.equal(api.calls.failed[0].error.retryable, false);
  await daemon.stop('TEST');
});

test('concurrencia global llega a dos y nunca supera el límite', async (t) => {
  const stateDir = tempDirectory(t);
  const claims = [
    claim,
    {
      ...claim,
      leaseToken: 'lease-2', requestId: 'request-2', caseId: 'case-2', workItemId: 'work-2',
      agentId: 'systems-manager-ai-v1', handlerKey: 'systems-manager-advisory', contractVersion: '1.1.0', slotNo: 2,
      contract: { ...claim.contract },
    },
  ];
  const api = fakeApi(claims);
  const resolvers = [];
  let running = 0;
  let maximum = 0;
  const daemon = createDaemon({ stateDir, api, processor: { runClaim: async () => new Promise((resolve) => {
    running += 1;
    maximum = Math.max(maximum, running);
    resolvers.push(() => { running -= 1; resolve({ status: 'COMPLETED' }); });
  }) } });
  await daemon.start({ runImmediately: false });
  assert.deepEqual(await daemon.tickPoll(), { claimed: 2, attempts: 2 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(daemon.snapshot().activeCount, 2);
  assert.equal(maximum, 2);
  assert.equal(api.calls.claims, 2);
  daemon.draining = true;
  resolvers.forEach((resolve) => resolve());
  await new Promise((resolve) => setImmediate(resolve));
  daemon.draining = false;
  await daemon.stop('TEST');
});

test('concurrencia por agente rechaza un segundo claim del mismo agente', async (t) => {
  const stateDir = tempDirectory(t);
  const api = fakeApi([
    claim,
    { ...claim, leaseToken: 'lease-2', requestId: 'request-2', caseId: 'case-2', workItemId: 'work-2' },
  ]);
  let finish;
  const daemon = createDaemon({ stateDir, api, processor: { runClaim: async () => new Promise((resolve) => { finish = resolve; }) } });
  await daemon.start({ runImmediately: false });
  assert.deepEqual(await daemon.tickPoll(), { claimed: 1, attempts: 3 });
  assert.equal(api.calls.failed.length, 1);
  assert.equal(api.calls.failed[0].error.code, 'AGENT_CONCURRENCY_EXCEEDED');
  daemon.draining = true;
  finish({ status: 'COMPLETED' });
  await new Promise((resolve) => setImmediate(resolve));
  daemon.draining = false;
  await daemon.stop('TEST');
});

test('heartbeat idle, reconcile y schedule corren aunque no haya trabajo', async (t) => {
  const stateDir = tempDirectory(t);
  const api = fakeApi([]);
  const daemon = createDaemon({ stateDir, api, processor: { runClaim: async () => ({ status: 'COMPLETED' }) } });
  await daemon.start({ runImmediately: false });
  await daemon.tickWorkerHeartbeat();
  await daemon.tickReconcile();
  await daemon.tickSchedule();
  assert.deepEqual(api.calls.workerHeartbeats.map(({ state }) => state), ['STARTING', 'IDLE']);
  assert.deepEqual(api.calls.workerHeartbeats[0].dependencies.map(({ key }) => key), [
    'network', 'vercel-api', 'supabase-postgres', 'inference-router', 'openai-api', 'ollama-local', 'openclaw-optional',
  ]);
  assert.deepEqual(api.calls.workerHeartbeats[0].dependencies.map(({ status }) => status), [
    'UNOBSERVED', 'UNOBSERVED', 'UNOBSERVED', 'UNOBSERVED', 'UNOBSERVED', 'UNOBSERVED', 'UNOBSERVED',
  ]);
  assert.equal(api.calls.workerHeartbeats[1].dependencies.find(({ key }) => key === 'vercel-api').status, 'HEALTHY');
  assert.equal(api.calls.reconcile, 1);
  assert.equal(api.calls.schedule, 1);
  await daemon.stop('TEST');
});

test('scheduler persiste cada tick natural y distingue generación, dedupe, vacío y fallo', async (t) => {
  const stateDir = tempDirectory(t);
  const api = fakeApi([]);
  const daemon = createDaemon({ stateDir, api, processor: { runClaim: async () => ({ status: 'COMPLETED' }) } });
  const logger = new JsonRotatingLogger({ logDir: join(stateDir, 'logs'), mirrorConsole: false });
  daemon.logger = logger;
  const timerCallbacks = [];
  daemon.installTimer = (callback) => timerCallbacks.push(callback);
  await daemon.start({ runImmediately: false });
  const scheduleTick = timerCallbacks[3];
  assert.equal(typeof scheduleTick, 'function');
  api.schedule = async () => ({ scheduled: 2, results: [{ reused: false }, { reused: true }], modelCalls: 0 });
  await scheduleTick();
  api.schedule = async () => ({ scheduled: 0, results: [], modelCalls: 0 });
  await scheduleTick();
  api.schedule = async () => { throw Object.assign(new Error('authorization: Bearer private-value'), { code: 'COMPANY_OS_RUNTIME_API_TIMEOUT', retryable: true }); };
  await scheduleTick();
  api.schedule = async () => ({ accepted: true });
  await scheduleTick();

  const lines = readFileSync(logger.filePath, 'utf8');
  const entries = lines.trim().split('\n').map((line) => JSON.parse(line));
  const starts = entries.filter(({ event }) => event === 'RUNTIME_SCHEDULE_SCAN_STARTED');
  const finishes = entries.filter(({ event }) => event === 'RUNTIME_SCHEDULE_SCAN_FINISHED');
  assert.equal(starts.length, 4);
  assert.equal(finishes.length, 4);
  assert.equal(new Set(finishes.map(({ scanId }) => scanId)).size, 4);
  assert.deepEqual(finishes.map(({ scanNumber }) => scanNumber), [1, 2, 3, 4]);
  assert.deepEqual(finishes.map(({ generatedCount }) => generatedCount), [1, 0, null, null]);
  assert.deepEqual(finishes.map(({ reusedCount }) => reusedCount), [1, 0, null, null]);
  assert.deepEqual(finishes.map(({ success, exitCode, countsObserved }) => ({ success, exitCode, countsObserved })), [
    { success: true, exitCode: 0, countsObserved: true },
    { success: true, exitCode: 0, countsObserved: true },
    { success: false, exitCode: 1, countsObserved: false },
    { success: true, exitCode: 0, countsObserved: false },
  ]);
  for (const [index, scan] of finishes.entries()) {
    assert.equal(scan.scanId, starts[index].scanId);
    assert.equal(scan.trigger, 'INTERVAL');
    assert.equal(scan.instanceId, 'instance-test');
    assert.ok(scan.durationMs >= 0);
    assert.ok(Date.parse(scan.finishedAt) >= Date.parse(scan.startedAt));
  }
  assert.equal(finishes[2].errorCode, 'COMPANY_OS_RUNTIME_API_TIMEOUT');
  assert.equal(lines.includes('private-value'), false);
  assert.equal(daemon.scheduling, false);
  await daemon.stop('TEST');
});

test('journal continuo separa generación y cobertura de agendas, sin fabricar ceros ausentes o inválidos', async (t) => {
  const stateDir = tempDirectory(t);
  const api = fakeApi([]);
  const daemon = createDaemon({ stateDir, api, processor: { runClaim: async () => ({ status: 'COMPLETED' }) } });
  const logger = new JsonRotatingLogger({ logDir: join(stateDir, 'logs'), mirrorConsole: false });
  daemon.logger = logger;
  await daemon.start({ runImmediately: false });
  const observed = { generatedCount: 2, observed: 50, excluded: 7, scannedObjectives: 1, eligibleSources: 4, blockedExternal: 0, noWorkReason: 'READY_TO_CLAIM' };
  const responses = [
    { scheduled: 1, results: [{ reused: true }], continuous: observed },
    { scheduled: 0, results: [], continuous: { generatedCount: 0, observed: 0, excluded: 0, scannedObjectives: 0 } },
    { scheduled: 1, results: [{ reused: false }] },
    ...[undefined, null, [], {}, { ...observed, observed: '50' }, { ...observed, excluded: -1 },
      { ...observed, generatedCount: 0.5 }, { ...observed, scannedObjectives: Number.MAX_SAFE_INTEGER + 1 }]
      .map((continuous) => ({ scheduled: 0, results: [], continuous })),
    { accepted: true, continuous: observed },
  ];
  for (const response of responses) {
    api.schedule = async () => response;
    await daemon.tickSchedule({ trigger: 'INTERVAL' });
  }
  api.schedule = async () => { throw Object.assign(new Error('schedule unavailable'), { code: 'COMPANY_OS_RUNTIME_API_TIMEOUT' }); };
  await daemon.tickSchedule({ trigger: 'INTERVAL' });
  const finishes = readFileSync(logger.filePath, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    .filter(({ event }) => event === 'RUNTIME_SCHEDULE_SCAN_FINISHED');
  const counts = ({ continuousCountsObserved, continuousGeneratedCount, continuousSourcesObserved, continuousExcludedCount, continuousObjectivesScanned,
    continuousEligibleSourceCount, continuousBlockedExternalCount, continuousNoWorkReason }) =>
    [continuousCountsObserved, continuousGeneratedCount, continuousSourcesObserved, continuousExcludedCount, continuousObjectivesScanned,
      continuousEligibleSourceCount, continuousBlockedExternalCount, continuousNoWorkReason];
  assert.deepEqual(counts(finishes[0]), [true, 2, 50, 7, 1, 4, 0, 'READY_TO_CLAIM']);
  assert.deepEqual([finishes[0].generatedCount, finishes[0].reusedCount], [0, 1]);
  assert.deepEqual(counts(finishes[1]), [true, 0, 0, 0, 0, null, null, null]);
  for (const finish of finishes.slice(2, -2)) assert.deepEqual(counts(finish), [false, null, null, null, null, null, null, null]);
  assert.equal(finishes[2].generatedCount, 1);
  assert.deepEqual(counts(finishes.at(-2)), [true, 2, 50, 7, 1, 4, 0, 'READY_TO_CLAIM']);
  assert.equal(finishes.at(-2).countsObserved, false);
  assert.equal(finishes.at(-2).generatedCount, null);
  assert.deepEqual(counts(finishes.at(-1)), [false, null, null, null, null, null, null, null]);
  assert.equal(finishes.at(-1).success, false);
  assert.equal(finishes.at(-1).exitCode, 1);
  assert.equal(new Set(finishes.map(({ scanId }) => scanId)).size, finishes.length);
  await daemon.stop('TEST');
});

test('un fallo OpenAI observable deja runtime y dependencia en DEGRADED', async (t) => {
  const stateDir = tempDirectory(t);
  const api = fakeApi([claim]);
  const daemon = createDaemon({
    stateDir,
    api,
    processor: { runClaim: async () => ({ status: 'FAILED', error: { code: 'OPENAI_TIMEOUT', message: 'timeout', retryable: true } }) },
  });
  await daemon.start({ runImmediately: false });
  await daemon.tickPoll();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(daemon.snapshot().state, 'DEGRADED');
  assert.equal(daemon.heartbeatPayload().dependencies.find(({ key }) => key === 'inference-router').status, 'DEGRADED');
  assert.equal(daemon.heartbeatPayload().dependencies.find(({ key }) => key === 'openai-api').status, 'DEGRADED');
  assert.equal(daemon.snapshot().lastErrorCode, 'OPENAI_TIMEOUT');
  await daemon.stop('TEST');
});

test('fallback Qwen deja el router saludable y conserva OpenAI degradado como dependencia opcional', async (t) => {
  const stateDir = tempDirectory(t);
  const api = fakeApi([claim]);
  const daemon = createDaemon({
    stateDir,
    api,
    processor: { runClaim: async () => ({
      status: 'COMPLETED',
      modelProvider: 'ollama',
      model: 'qwen3:14b-q4_K_M',
      fallbackReason: 'OPENAI_HTTP_ERROR',
    }) },
  });
  await daemon.start({ runImmediately: false });
  await daemon.tickPoll();
  await new Promise((resolve) => setImmediate(resolve));
  const dependencies = daemon.heartbeatPayload().dependencies;
  assert.equal(daemon.snapshot().state, 'IDLE');
  assert.equal(dependencies.find(({ key }) => key === 'inference-router').status, 'HEALTHY');
  assert.equal(dependencies.find(({ key }) => key === 'openai-api').status, 'DEGRADED');
  assert.equal(dependencies.find(({ key }) => key === 'ollama-local').status, 'HEALTHY');
  await daemon.stop('TEST');
});

test('Ollama directo conserva la observación previa de OpenAI sin inventar un fallo', async (t) => {
  for (const prior of [
    { status: 'UNOBSERVED', observedAt: null, detail: null },
    { status: 'HEALTHY', observedAt: '2026-09-01T12:00:00.000Z', detail: 'verified-model' },
    { status: 'DEGRADED', observedAt: '2026-09-01T12:00:00.000Z', detail: 'OPENAI_TIMEOUT' },
  ]) {
    const stateDir = tempDirectory(t);
    const daemon = createDaemon({
      stateDir,
      api: fakeApi([claim]),
      processor: { runClaim: async () => ({
        status: 'COMPLETED', modelProvider: 'ollama', model: 'qwen3:14b-q4_K_M', fallbackReason: null,
      }) },
    });
    daemon.openAiDependency = { ...prior };
    await daemon.start({ runImmediately: false });
    await daemon.tickPoll();
    await new Promise((resolve) => setImmediate(resolve));
    const dependencies = daemon.heartbeatPayload().dependencies;
    assert.deepEqual(dependencies.find(({ key }) => key === 'openai-api'), { key: 'openai-api', ...prior });
    assert.equal(dependencies.find(({ key }) => key === 'ollama-local').status, 'HEALTHY');
    assert.equal(dependencies.find(({ key }) => key === 'inference-router').status, 'HEALTHY');
    assert.equal(daemon.snapshot().state, 'IDLE');
    await daemon.stop('TEST');
  }
});

test('SIGTERM lógico entra en DRAINING y espera el trabajo antes de STOPPED', async (t) => {
  const stateDir = tempDirectory(t);
  const api = fakeApi([claim]);
  let finish;
  const daemon = createDaemon({ stateDir, api, processor: { runClaim: async () => new Promise((resolve) => { finish = resolve; }) } });
  await daemon.start({ runImmediately: false });
  await daemon.tickPoll();
  await new Promise((resolve) => setImmediate(resolve));
  const stopping = daemon.stop('SIGTERM');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(daemon.snapshot().state, 'DRAINING');
  finish({ status: 'COMPLETED' });
  assert.deepEqual(await stopping, { drained: true, activeRemaining: 0 });
  assert.deepEqual(api.calls.workerHeartbeats.map(({ state }) => state), ['STARTING', 'DRAINING', 'STOPPED']);
  assert.equal(daemon.snapshot().state, 'STOPPED');
});

test('drenaje respeta el máximo configurado y reporta trabajo remanente', async (t) => {
  const stateDir = tempDirectory(t);
  const api = fakeApi([claim]);
  let finish;
  const daemon = createDaemon({
    stateDir,
    api,
    processor: { runClaim: async () => new Promise((resolve) => { finish = resolve; }) },
    sleep: async () => {},
  });
  await daemon.start({ runImmediately: false });
  await daemon.tickPoll();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(await daemon.stop('SIGTERM'), { drained: false, activeRemaining: 1 });
  finish({ status: 'COMPLETED' });
});

test('health sólo liga loopback y refleja estado degradado', async (t) => {
  let state = 'IDLE';
  const health = createRuntimeHealthServer({
    host: '127.0.0.1',
    port: 0,
    snapshot: () => ({ workerId: 'worker-test', instanceId: 'instance-test', state }),
  });
  t.after(() => health.close());
  const address = await health.listen();
  assert.equal(address.address, '127.0.0.1');
  let response = await fetch(`http://127.0.0.1:${address.port}/health`);
  assert.equal(response.status, 200);
  const healthBody = await response.json();
  assert.equal(healthBody.contract, 'runtime-v1');
  assert.equal(healthBody.binaryVersion, '1.1.0');
  assert.equal(healthBody.contractVersion, 'runtime-v1');
  state = 'DEGRADED';
  response = await fetch(`http://127.0.0.1:${address.port}/health`);
  assert.equal(response.status, 503);
  assert.throws(() => createRuntimeHealthServer({ host: '0.0.0.0', port: 0, snapshot: () => ({}) }), /127\.0\.0\.1/);
});

test('lock impide una segunda instancia y permite recuperar un lock obsoleto', (t) => {
  const stateDir = tempDirectory(t);
  const lockPath = join(stateDir, 'runtime.lock');
  const first = new InstanceLock({ lockPath, workerId: 'worker-test', instanceId: 'instance-1' });
  const second = new InstanceLock({ lockPath, workerId: 'worker-test', instanceId: 'instance-2' });
  first.acquire();
  assert.throws(() => second.acquire(), (error) => error.code === 'RUNTIME_INSTANCE_ALREADY_ACTIVE');
  first.release();
  second.acquire();
  second.release();
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(lockPath, JSON.stringify({ pid: 2_147_483_647, instanceId: 'stale' }));
  const recovered = new InstanceLock({ lockPath, workerId: 'worker-test', instanceId: 'instance-3' });
  recovered.acquire();
  recovered.release();
  assert.equal(existsSync(lockPath), false);
});

test('logs JSON rotan y no persisten campos ni patrones de credenciales', (t) => {
  const stateDir = tempDirectory(t);
  const logDir = join(stateDir, 'logs');
  const logger = new JsonRotatingLogger({ logDir, maxBytes: 220, maxFiles: 2, mirrorConsole: false });
  for (let index = 0; index < 8; index += 1) {
    logger.info('TEST_EVENT', {
      index,
      password: 'do-not-persist',
      nested: { apiKey: 'also-do-not-persist' },
      message: 'credential ghp_abcdefghijklmnopqrstuvwxyz123456',
    });
  }
  const files = readdirSync(logDir).filter((name) => name.startsWith('runtime.jsonl'));
  assert.ok(files.includes('runtime.jsonl'));
  assert.ok(files.some((name) => name !== 'runtime.jsonl'));
  const persisted = files.map((name) => readFileSync(join(logDir, name), 'utf8')).join('\n');
  assert.doesNotMatch(persisted, /do-not-persist|also-do-not-persist|ghp_/);
  assert.match(persisted, /SECRET_REDACTED|REDACTED/);
});
