import assert from 'node:assert/strict';
import test from 'node:test';
import { requiresLocalInference } from '../src/data-policy.mjs';
import { OpenAiAdvisoryClient } from '../src/openai-client.mjs';
import { buildDaemonRuntime } from '../src/server.mjs';
import { loadRuntimeConfig } from '../src/runtime-config.mjs';

const localPolicy = { version: 1, inference: 'LOCAL_ONLY', reason: 'DATA_MANAGER_LINEAGE' };
const standardPolicy = { version: 1, inference: 'STANDARD', reason: 'DEFAULT' };
const output = { summary: 'Resultado Data integrado.', needsHumanDecision: false, confidence: 0.95 };
const claim = {
  caseId: 'case-data-lineage', agentId: 'general-manager-ai-v3',
  objective: 'Integrar resultado de Datos.',
  dataPolicy: localPolicy,
  evidencePayload: { quality: { coverage: 'observed' } },
  // The model window deliberately contains no Data message.
  contextMessages: [],
  advisoryOnly: true,
  contractVersion: '3.1.2',
  contract: {
    agentId: 'general-manager-ai-v3', advisoryOnly: true,
    lowConfidencePolicy: { minConfidence: 0.75 },
    outputSchema: {
      type: 'object', additionalProperties: false,
      required: ['summary', 'needsHumanDecision', 'confidence'],
      properties: {
        summary: { type: 'string', minLength: 1 },
        needsHumanDecision: { type: 'boolean' },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
  },
  budgets: { maxOutputTokens: 100, targetTotalTokens: 1_000 },
};

function runtime(fetchImpl) {
  const config = loadRuntimeConfig({
    COMPANY_OS_RUNTIME_HMAC_SECRET: 'test-runtime-secret',
    COMPANY_OS_EXTERNAL_IDENTITY_HMAC_SECRET: 'test-external-identity-secret',
    OPENAI_API_KEY: 'test-openai-key',
    COMPANY_OS_RUNTIME_STATE_DIR: '/private/tmp/company-os-policy-test-unused',
    COMPANY_OS_RUNTIME_OLLAMA_FALLBACK_ENABLED: 'false',
  });
  return buildDaemonRuntime(config, {
    api: {}, logger: { info() {}, warn() {}, error() {} },
    instanceId: 'policy-test', fetchImpl,
  });
}

test('Data identity and local lineage cannot be downgraded by absent or malformed policies', () => {
  assert.equal(requiresLocalInference({ agentId: 'data-manager-ai-v1', dataPolicy: standardPolicy }), true);
  for (const policy of [localPolicy, null, {}, { version: 2, inference: 'STANDARD', reason: 'DEFAULT' }, { ...standardPolicy, reason: 'DATA_MANAGER_LINEAGE' }]) {
    assert.equal(requiresLocalInference({ ...claim, dataPolicy: policy }), true);
  }
  assert.equal(requiresLocalInference({ ...claim, dataPolicy: standardPolicy }), false);
  assert.equal(requiresLocalInference({ agentId: 'general-manager-ai-v3' }), false);
});

test('OpenAI blocks General and Systems with Data lineage before any network request', async () => {
  let networkCalls = 0;
  const client = new OpenAiAdvisoryClient({
    apiKey: 'test-key', fetchImpl: async () => { networkCalls += 1; throw new Error('NETWORK_MUST_NOT_RUN'); },
  });
  for (const agentId of ['general-manager-ai-v3', 'systems-manager-ai-v1', 'data-manager-ai-v1']) {
    await assert.rejects(client.generate({ ...claim, agentId }), (error) => error.code === 'OPENAI_DATA_EXPORT_DISABLED');
  }
  assert.equal(networkCalls, 0);
});

test('General return uses local Ollama with fallback disabled and preserves local lineage evidence', async () => {
  const urls = [];
  const worker = runtime(async (url, init) => {
    urls.push(url);
    assert.equal(url, 'http://127.0.0.1:11434/api/chat');
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'qwen3:4b-q4_K_M');
    assert.match(body.messages[1].content, /Integrar resultado/);
    return new Response(JSON.stringify({
      model: 'qwen3:4b-q4_K_M', done: true,
      message: { content: JSON.stringify(output) },
      prompt_eval_count: 20, eval_count: 10, total_duration: 1_000_000,
    }), { status: 200 });
  });
  const result = await worker.processor.openai.generate(claim);
  assert.deepEqual(result.output, output);
  assert.deepEqual(urls, ['http://127.0.0.1:11434/api/chat']);
  assert.ok(result.usage.rules_applied.includes('data-manager-lineage-local-only'));
  assert.equal(result.usage.rules_applied.includes('openai-retryable-fallback-only'), false);
});

test('local lineage never falls through to OpenAI when Ollama fails', async () => {
  const urls = [];
  const worker = runtime(async (url) => {
    urls.push(url);
    return new Response('{}', { status: 503 });
  });
  await assert.rejects(worker.processor.openai.generate(claim), (error) => error.code === 'OLLAMA_HTTP_ERROR');
  assert.deepEqual(urls, ['http://127.0.0.1:11434/api/chat']);
});

test('continuous objective initial General claim stays local, with exact advisory validation and no cloud retry', async () => {
  const objectiveClaim = { ...claim, dataPolicy: { version: 1, inference: 'LOCAL_ONLY', reason: 'CONTINUOUS_OBJECTIVE' }, budgets: { maxOutputTokens: 1500, targetTotalTokens: 6000 } };
  const urls = [];
  const worker = runtime(async (url, init) => {
    urls.push(url);
    assert.equal(url, 'http://127.0.0.1:11434/api/chat');
    assert.equal(JSON.parse(init.body).options.num_predict, 1500);
    return new Response(JSON.stringify({ model: 'qwen3:4b-q4_K_M', done: true,
      message: { content: JSON.stringify(output) }, prompt_eval_count: 20, eval_count: 10 }), { status: 200 });
  });
  const result = await worker.processor.openai.generate(objectiveClaim);
  assert.deepEqual(result.output, output);
  assert.ok(result.usage.rules_applied.includes('continuous-objective-local-only'));
  assert.equal(result.usage.rules_applied.includes('data-manager-lineage-local-only'), false);
  assert.deepEqual(urls, ['http://127.0.0.1:11434/api/chat']);
  const cloud = new OpenAiAdvisoryClient({ apiKey: 'test-key', fetchImpl: async () => { assert.fail('cloud prohibited'); } });
  await assert.rejects(cloud.generate(objectiveClaim), (error) => error.code === 'OPENAI_DATA_EXPORT_DISABLED');
  const failing = runtime(async (url) => { assert.equal(url, 'http://127.0.0.1:11434/api/chat'); return new Response('{}', { status: 503 }); });
  await assert.rejects(failing.processor.openai.generate(objectiveClaim), (error) => error.code === 'OLLAMA_HTTP_ERROR');
});

test('General without Data lineage retains its primary model route', async () => {
  const worker = runtime(async () => { throw new Error('NETWORK_NOT_EXPECTED'); });
  const calls = [];
  worker.processor.openai.primary.generate = async () => { calls.push('primary'); return { output }; };
  worker.processor.openai.fallback.generate = async () => { calls.push('local'); return { output }; };
  await worker.processor.openai.generate({ ...claim, dataPolicy: standardPolicy });
  assert.deepEqual(calls, ['primary']);
});

test('adaptive local reservation reaches num_predict; truncated output retains real usage without retry', async () => {
  const objectiveClaim = { ...claim,
    dataPolicy: { version: 1, inference: 'LOCAL_ONLY', reason: 'CONTINUOUS_OBJECTIVE' },
    budgets: { input: 9000, maxOutputTokens: 1418, targetTotalTokens: 10418 } };
  let calls = 0;
  const worker = runtime(async (url, init) => {
    calls += 1;
    assert.equal(url, 'http://127.0.0.1:11434/api/chat');
    assert.equal(JSON.parse(init.body).options.num_predict, 1418);
    return new Response(JSON.stringify({ model: 'qwen3:4b-q4_K_M', done: true,
      message: { content: '{"summary":' }, prompt_eval_count: 2200, eval_count: 1418 }), { status: 200 });
  });
  await assert.rejects(worker.processor.openai.generate(objectiveClaim), (error) => {
    assert.equal(error.usage.total_tokens, 3618);
    assert.equal(error.usage.output_tokens, 1418);
    return true;
  });
  assert.equal(calls, 1);
});
