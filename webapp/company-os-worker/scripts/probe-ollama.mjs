import { createHash } from 'node:crypto';
import { OllamaAdvisoryClient } from '../src/ollama-client.mjs';

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['decision', 'evidenceRefs'],
  properties: {
    decision: { type: 'string', enum: ['QUIESCENT'] },
    evidenceRefs: {
      type: 'array',
      minItems: 1,
      maxItems: 1,
      items: { type: 'string' },
    },
  },
};

const claim = {
  requestId: 'local-ollama-contract-probe',
  attemptId: 'local-ollama-contract-probe:1',
  caseId: 'synthetic-probe',
  agentId: 'general-manager-ai-v3',
  objective: 'Return decision QUIESCENT and cite only synthetic_probe.',
  evidencePayload: { synthetic_probe: { kind: 'synthetic', desiredStateSatisfied: true } },
  contextMessages: [],
  advisoryOnly: true,
  timeoutMs: 300_000,
  budgets: { maxOutputTokens: 256 },
  contractVersion: 'probe-1.0.0',
  contract: {
    agentId: 'general-manager-ai-v3',
    version: 'probe-1.0.0',
    advisoryOnly: true,
    outputSchema: schema,
    lowConfidencePolicy: { minConfidence: 0.75 },
  },
};

const client = new OllamaAdvisoryClient({
  baseUrl: process.env.COMPANY_OS_RUNTIME_OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
  model: process.env.COMPANY_OS_RUNTIME_OLLAMA_MODEL || 'qwen3:14b-q4_K_M',
  timeoutMs: 300_000,
  requireClaimOutputSchema: true,
});

const result = await client.generate(claim);
const outputHash = createHash('sha256').update(JSON.stringify(result.output)).digest('hex');
process.stdout.write(`${JSON.stringify({
  ok: true,
  provider: result.usage.provider,
  model: result.usage.model,
  inputTokens: result.usage.input_tokens,
  outputTokens: result.usage.output_tokens,
  durationMs: result.usage.duration_ms,
  outputHash,
  decision: result.output.decision,
  evidenceRefs: result.output.evidenceRefs,
})}\n`);
