import assert from 'node:assert/strict';
import test from 'node:test';
import { OllamaAdvisoryClient, RetryableModelFallbackClient } from '../src/ollama-client.mjs';

const claim = {
  caseId: 'synthetic-case', agentId: 'general-manager-ai-v3', objective: 'Analyze synthetic evidence',
  evidencePayload: { 'E-1': { fact: 'synthetic evidence' } },
  budgets: { targetTotalTokens: 12_000, maxOutputTokens: 3_000 },
};
const output = {
  summary: 'Synthetic evidence requires an owner.', primaryDataQualityProblem: 'No owner observed.',
  evidenceRefs: ['E-1'], recommendedNextStep: 'Request human review.', missions: [],
};

function clientWith(counters) {
  let calls = 0;
  const client = new OllamaAdvisoryClient({
    requireClaimOutputSchema: false,
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({
        model: 'qwen3:14b-q4_K_M', done: true, message: { content: JSON.stringify(output) }, ...counters,
      }), { status: 200 });
    },
  });
  return { client, calls: () => calls };
}

function assertUnknown(error) {
  assert.equal(error.code, 'OLLAMA_USAGE_UNOBSERVED');
  assert.equal(error.retryable, false);
  assert.equal(error.usageKnown, false);
  assert.equal(error.usage.usage_known, false);
  for (const key of ['input_tokens', 'output_tokens', 'total_tokens']) assert.equal(Object.hasOwn(error.usage, key), false);
  assert.equal(error.usage.provider, 'ollama');
  assert.ok(error.usage.rules_applied.includes('usage-unobserved-provider-counters'));
  assert.ok(error.usage.rules_applied.includes('reserve-pending-accounting-reconciliation'));
  return true;
}

test('missing or invalid Ollama counters preserve unknown usage and forbid inference retry', async () => {
  const invalid = [undefined, null, -1, 1.5, '10', true, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1];
  for (const field of ['prompt_eval_count', 'eval_count']) {
    for (const value of invalid) {
      const { client, calls } = clientWith({ prompt_eval_count: 10, eval_count: 20, [field]: value });
      await assert.rejects(client.generate(claim), assertUnknown);
      assert.equal(calls(), 1);
    }
  }
  const { client } = clientWith({ prompt_eval_count: Number.MAX_SAFE_INTEGER, eval_count: 1 });
  await assert.rejects(client.generate(claim), assertUnknown);
});

test('explicit nonnegative integer counters remain measured usage, including explicit zero', async () => {
  for (const [input, generated] of [[10, 20], [0, 0], [0, 20]]) {
    const { client } = clientWith({ prompt_eval_count: input, eval_count: generated });
    const result = await client.generate(claim);
    assert.equal(result.usage.input_tokens, input);
    assert.equal(result.usage.output_tokens, generated);
    assert.equal(result.usage.total_tokens, input + generated);
    assert.notEqual(result.usage.usage_known, false);
  }
});

test('fallback keeps accounting errors nonretryable and never converts absent usage into zero', async () => {
  const { client, calls } = clientWith({});
  const router = new RetryableModelFallbackClient({
    primary: { generate: async () => { throw Object.assign(new Error('Synthetic primary failure'), {
      code: 'OPENAI_HTTP_ERROR', status: 503, retryable: true, retryCount: 1,
    }); } },
    fallback: client,
  });
  await assert.rejects(router.generate(claim), (error) => {
    assertUnknown(error);
    assert.equal(error.usage.retry_count, 2);
    assert.equal(error.usage.fallback_from_provider, 'openai');
    return true;
  });
  assert.equal(calls(), 1);
});
