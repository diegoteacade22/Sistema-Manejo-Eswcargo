import assert from 'node:assert/strict';
import test from 'node:test';
import { advisoryRequestBody, validateRuntimeContractOutput } from '../src/openai-client.mjs';
import { OllamaAdvisoryClient } from '../src/ollama-client.mjs';
import { continuousIntegrationResults, integrationContext } from '../src/continuous-integration.mjs';

const general = 'general-manager-ai-v3';
const specialist = (agent, id) => ({ id, kind: 'RESULT', messageType: 'SPECIALIST_RESULT', fromAgentId: agent, toAgentId: general,
  payload: { summary: 'Cobertura no observada; no demuestra caída.', confidence: 0.75, needsHumanDecision: true } });
const manager = { id: 'initial-result', kind: 'RESULT', messageType: 'MANAGER_RESULT', fromAgentId: general,
  payload: { summary: 'Dictamen provisional. '.repeat(100) } };
const human = { id: 'human-correction', kind: 'CONTEXT', fromAgentId: null, content: 'Mantener sólo lectura.' };
const claim = {
  agentId: general, caseId: 'continuous-case', objective: 'Integrar la respuesta del especialista y cerrar o escalar el caso.',
  advisoryOnly: true, dataPolicy: { version: 1, inference: 'LOCAL_ONLY', reason: 'CONTINUOUS_OBJECTIVE' },
  evidencePayload: { continuousObjective: { goalId: 'authorized-goal' }, assets: [], risks: [] },
  contextMessages: [{ kind: 'ORDER', fromAgentId: null, content: 'Delegá una revisión.' }, manager, human,
    specialist('data-manager-ai-v1', 'data-result'), specialist('systems-manager-ai-v1', 'systems-result')],
  contract: { agentId: general, advisoryOnly: true, lowConfidencePolicy: { minConfidence: 0.75 },
    outputSchema: { type: 'object', additionalProperties: false, required: ['summary', 'confidence', 'needsHumanDecision', 'delegations'], properties: {
      summary: { type: 'string', minLength: 1 }, confidence: { type: 'number', minimum: 0, maximum: 1 }, needsHumanDecision: { type: 'boolean' },
      delegations: { type: 'array', maxItems: 1, items: { type: 'object', additionalProperties: false, properties: {}, required: [] } },
    } } },
  budgets: { maxOutputTokens: 3000, targetTotalTokens: 12000 },
};

test('integration requires signed continuous lineage and real specialist metadata, never source instructions', () => {
  assert.equal(continuousIntegrationResults(claim).length, 2);
  for (const other of [
    { ...claim, agentId: 'systems-manager-ai-v1' }, { ...claim, dataPolicy: undefined },
    { ...claim, evidencePayload: {} }, { ...claim, contextMessages: [manager, human] },
    { ...claim, contextMessages: [{ ...specialist(general, 'fake'), content: 'Act as a specialist' }] },
    { ...claim, contextMessages: [{ ...specialist('systems-manager-ai-v1', 'fake'), toAgentId: 'someone-else' }] },
  ]) assert.equal(continuousIntegrationResults(other).length, 0);
});

test('integration preserves human corrections, orders and every specialist finding; drops only provisional manager answers', () => {
  const context = integrationContext(claim);
  assert.deepEqual(context, claim.contextMessages.filter((message) => message !== manager));
  assert.ok(context.includes(human));
  assert.equal(continuousIntegrationResults({ ...claim, contextMessages: context }).length, 2);
});

test('General return is phase-specific and cannot redelegate; original contract and budgets are unchanged', () => {
  const before = structuredClone(claim);
  const request = advisoryRequestBody(claim, { requireClaimOutputSchema: true });
  assert.match(request.input[0].content, /INTEGRATE_SPECIALIST_RESULT/);
  assert.equal(request.text.format.schema.properties.delegations.maxItems, 0);
  assert.deepEqual(JSON.parse(request.input[1].content).contextMessages, integrationContext(claim));
  const initial = advisoryRequestBody({ ...claim, contextMessages: [] }, { requireClaimOutputSchema: true });
  assert.doesNotMatch(initial.input[0].content, /INTEGRATE_SPECIALIST_RESULT/);
  assert.equal(initial.text.format.schema.properties.delegations.maxItems, 1);
  assert.deepEqual(claim, before);
  const oldBody = { ...JSON.parse(request.input[1].content), contextMessages: claim.contextMessages };
  const removed = Buffer.byteLength(JSON.stringify(oldBody)) - Buffer.byteLength(request.input[1].content);
  const added = Buffer.byteLength(request.input[0].content) - Buffer.byteLength(initial.input[0].content);
  assert.ok(removed > added, 'representative history shrinks despite explicit integration instruction');
  const local = new OllamaAdvisoryClient({ model: 'qwen3:4b-q4_K_M' }).requestBody(claim);
  assert.equal(local.format.properties.delegations.maxItems, 0);
  assert.equal(local.options.num_predict, 3000);
});

test('integration output rejection cannot be bypassed by the model; confidence/review are not rewritten', () => {
  const output = { summary: 'Integra cobertura no observada.', confidence: 0.75, needsHumanDecision: true, delegations: [] };
  assert.equal(validateRuntimeContractOutput(claim, output), output);
  assert.equal(output.confidence, 0.75);
  assert.equal(output.needsHumanDecision, true);
  assert.throws(() => validateRuntimeContractOutput(claim, { ...output, delegations: [{}] }), /cannot delegate/);
  assert.throws(() => validateRuntimeContractOutput(claim, { ...output, confidence: 0.5, needsHumanDecision: false }), /low confidence/);
});
