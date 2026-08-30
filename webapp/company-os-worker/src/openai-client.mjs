export const ADVISORY_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'primaryDataQualityProblem', 'evidenceRefs', 'recommendedNextStep', 'missions'],
  properties: {
    summary: { type: 'string' },
    primaryDataQualityProblem: { type: 'string' },
    evidenceRefs: { type: 'array', items: { type: 'string' } },
    recommendedNextStep: { type: 'string' },
    missions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'objective', 'evidenceRefs', 'status'],
        properties: {
          title: { type: 'string' },
          objective: { type: 'string' },
          evidenceRefs: { type: 'array', items: { type: 'string' } },
          status: { type: 'string', enum: ['PLANNED'] },
        },
      },
    },
  },
});

export const SYSTEMS_ADVISORY_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'primaryConfirmedRisk', 'primaryCoverageGap', 'confirmedRiskNextStep', 'coverageGapNextStep', 'evidenceRefs', 'actionableRisks', 'missions'],
  properties: {
    summary: { type: 'string' },
    primaryConfirmedRisk: { type: 'string' },
    primaryCoverageGap: { type: 'string' },
    confirmedRiskNextStep: { type: 'string' },
    coverageGapNextStep: { type: 'string' },
    evidenceRefs: { type: 'array', items: { type: 'string' } },
    actionableRisks: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['riskId', 'title', 'assetId', 'classification', 'priority', 'evidenceRefs'],
        properties: {
          riskId: { type: 'string' },
          title: { type: 'string' },
          assetId: { type: 'string' },
          classification: { type: 'string', enum: ['ACTION_REQUIRED'] },
          priority: { type: 'integer', minimum: 0, maximum: 100 },
          evidenceRefs: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    missions: ADVISORY_OUTPUT_SCHEMA.properties.missions,
  },
});

export function advisoryOutputSchemaFor(evidencePayload) {
  const keys = Object.keys(evidencePayload || {}).filter((key) => typeof key === 'string' && key.length > 0);
  const schema = structuredClone(ADVISORY_OUTPUT_SCHEMA);
  schema.properties.evidenceRefs.items = { type: 'string', enum: keys };
  schema.properties.missions.items.properties.evidenceRefs.items = { type: 'string', enum: keys };
  return schema;
}

export function systemsAdvisoryOutputSchemaFor(evidencePayload) {
  const keys = Object.keys(evidencePayload || {}).filter((key) => typeof key === 'string' && key.length > 0);
  const schema = structuredClone(SYSTEMS_ADVISORY_OUTPUT_SCHEMA);
  schema.properties.evidenceRefs.items = { type: 'string', enum: keys };
  const assetIds = Array.isArray(evidencePayload?.assets) ? evidencePayload.assets.map((item) => item?.assetId).filter(Boolean) : [];
  const riskIds = Array.isArray(evidencePayload?.risks) ? evidencePayload.risks.filter((item) => item?.classification === 'ACTION_REQUIRED').map((item) => item?.riskId).filter(Boolean) : [];
  schema.properties.actionableRisks.items.properties.assetId = { type: 'string', enum: assetIds };
  schema.properties.actionableRisks.items.properties.riskId = { type: 'string', enum: riskIds };
  schema.properties.actionableRisks.items.properties.evidenceRefs.items = { type: 'string', enum: keys };
  schema.properties.missions.items.properties.evidenceRefs.items = { type: 'string', enum: keys };
  return schema;
}

export class OpenAiWorkerError extends Error {
  constructor(message, { retryable = false, code = 'OPENAI_ERROR', status = null } = {}) {
    super(message);
    this.name = 'OpenAiWorkerError';
    this.retryable = retryable;
    this.code = code;
    this.status = Number.isInteger(status) ? status : null;
  }
}

function outputText(response) {
  if (typeof response.output_text === 'string' && response.output_text.trim()) return response.output_text;
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === 'output_text' && typeof content.text === 'string') return content.text;
    }
  }
  throw new OpenAiWorkerError('OpenAI response contained no output text', { code: 'OPENAI_EMPTY_OUTPUT' });
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0);
}

export function validateAdvisoryOutput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new OpenAiWorkerError('OpenAI output is not an object', { code: 'OPENAI_INVALID_OUTPUT' });
  const allowed = ['summary', 'primaryDataQualityProblem', 'evidenceRefs', 'recommendedNextStep', 'missions'];
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new OpenAiWorkerError('OpenAI output contains unsupported fields', { code: 'OPENAI_INVALID_OUTPUT' });
  if (!['summary', 'primaryDataQualityProblem', 'recommendedNextStep'].every((key) => typeof value[key] === 'string' && value[key].length > 0)) {
    throw new OpenAiWorkerError('OpenAI output is missing advisory text', { code: 'OPENAI_INVALID_OUTPUT' });
  }
  if (!isStringArray(value.evidenceRefs) || !Array.isArray(value.missions)) throw new OpenAiWorkerError('OpenAI output has invalid evidence or missions', { code: 'OPENAI_INVALID_OUTPUT' });
  for (const mission of value.missions) {
    if (!mission || typeof mission !== 'object' || Array.isArray(mission)) throw new OpenAiWorkerError('OpenAI mission is invalid', { code: 'OPENAI_INVALID_OUTPUT' });
    const keys = Object.keys(mission);
    if (keys.some((key) => !['title', 'objective', 'evidenceRefs', 'status'].includes(key)) || mission.status !== 'PLANNED' || typeof mission.title !== 'string' || typeof mission.objective !== 'string' || !isStringArray(mission.evidenceRefs)) {
      throw new OpenAiWorkerError('OpenAI mission violates advisory policy', { code: 'OPENAI_INVALID_OUTPUT' });
    }
  }
  return value;
}

export function validateSystemsAdvisoryOutput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new OpenAiWorkerError('OpenAI systems output is not an object', { code: 'OPENAI_INVALID_OUTPUT' });
  const allowed = ['summary', 'primaryConfirmedRisk', 'primaryCoverageGap', 'confirmedRiskNextStep', 'coverageGapNextStep', 'evidenceRefs', 'actionableRisks', 'missions'];
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new OpenAiWorkerError('OpenAI systems output contains unsupported fields', { code: 'OPENAI_INVALID_OUTPUT' });
  const textFields = allowed.slice(0, 5);
  if (!textFields.every((key) => typeof value[key] === 'string' && value[key].length > 0)) throw new OpenAiWorkerError('OpenAI systems output is missing advisory text', { code: 'OPENAI_INVALID_OUTPUT' });
  if (!isStringArray(value.evidenceRefs) || !Array.isArray(value.actionableRisks) || value.actionableRisks.length > 5 || !Array.isArray(value.missions)) {
    throw new OpenAiWorkerError('OpenAI systems output has invalid collections', { code: 'OPENAI_INVALID_OUTPUT' });
  }
  for (const risk of value.actionableRisks) {
    if (!risk || typeof risk !== 'object' || Array.isArray(risk)
      || Object.keys(risk).some((key) => !['riskId', 'title', 'assetId', 'classification', 'priority', 'evidenceRefs'].includes(key))
      || typeof risk.riskId !== 'string' || typeof risk.title !== 'string' || typeof risk.assetId !== 'string' || risk.classification !== 'ACTION_REQUIRED'
      || !Number.isInteger(risk.priority) || risk.priority < 0 || risk.priority > 100 || !isStringArray(risk.evidenceRefs)) {
      throw new OpenAiWorkerError('OpenAI systems risk violates policy', { code: 'OPENAI_INVALID_OUTPUT' });
    }
  }
  for (const mission of value.missions) {
    if (!mission || typeof mission !== 'object' || Array.isArray(mission)
      || Object.keys(mission).some((key) => !['title', 'objective', 'evidenceRefs', 'status'].includes(key))
      || mission.status !== 'PLANNED' || typeof mission.title !== 'string' || typeof mission.objective !== 'string' || !isStringArray(mission.evidenceRefs)) {
      throw new OpenAiWorkerError('OpenAI mission violates advisory policy', { code: 'OPENAI_INVALID_OUTPUT' });
    }
  }
  return value;
}

const SUPPORTED_SCHEMA_KEYS = new Set([
  'type', 'additionalProperties', 'required', 'properties', 'items', 'enum', 'const',
  'minLength', 'maxLength', 'minItems', 'maxItems', 'minimum', 'maximum',
]);

function runtimeOutputError(message) {
  return new OpenAiWorkerError(message, { code: 'OPENAI_INVALID_RUNTIME_OUTPUT' });
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function validateRuntimeSchemaDefinition(schema, path = '$', depth = 0) {
  if (!isRecord(schema) || depth > 20) throw runtimeOutputError(`Runtime output schema is invalid at ${path}`);
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED_SCHEMA_KEYS.has(key)) throw runtimeOutputError(`Runtime output schema keyword is unsupported at ${path}.${key}`);
  }
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.length === 0)) {
    throw runtimeOutputError(`Runtime output schema enum is invalid at ${path}`);
  }
  const type = schema.type;
  if (type === undefined && (schema.const !== undefined || schema.enum !== undefined)) return schema;
  if (!['object', 'array', 'string', 'boolean', 'number', 'integer'].includes(type)) {
    throw runtimeOutputError(`Runtime output schema type is unsupported at ${path}`);
  }
  if (type === 'object') {
    if (schema.additionalProperties !== false || !isRecord(schema.properties) || !Array.isArray(schema.required)) {
      throw runtimeOutputError(`Runtime output object schema is not strict at ${path}`);
    }
    const propertyKeys = Object.keys(schema.properties);
    if (new Set(schema.required).size !== schema.required.length
      || schema.required.some((key) => typeof key !== 'string' || !Object.hasOwn(schema.properties, key))
      || propertyKeys.some((key) => !schema.required.includes(key))) {
      throw runtimeOutputError(`Runtime output object schema has inconsistent required fields at ${path}`);
    }
    for (const [key, nested] of Object.entries(schema.properties)) validateRuntimeSchemaDefinition(nested, `${path}.${key}`, depth + 1);
  }
  if (type === 'array') validateRuntimeSchemaDefinition(schema.items, `${path}[]`, depth + 1);
  return schema;
}

function valueEquals(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateValueAgainstSchema(value, schema, path = '$') {
  if (schema.const !== undefined && !valueEquals(value, schema.const)) throw runtimeOutputError(`Runtime output violates const at ${path}`);
  if (schema.enum !== undefined && !schema.enum.some((candidate) => valueEquals(candidate, value))) throw runtimeOutputError(`Runtime output violates enum at ${path}`);
  if (schema.type === 'object') {
    if (!isRecord(value)) throw runtimeOutputError(`Runtime output expected object at ${path}`);
    const keys = Object.keys(value);
    if (keys.some((key) => !Object.hasOwn(schema.properties, key)) || schema.required.some((key) => !Object.hasOwn(value, key))) {
      throw runtimeOutputError(`Runtime output fields do not match the contract at ${path}`);
    }
    for (const [key, nested] of Object.entries(schema.properties)) validateValueAgainstSchema(value[key], nested, `${path}.${key}`);
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) throw runtimeOutputError(`Runtime output expected array at ${path}`);
    if (schema.minItems !== undefined && value.length < schema.minItems) throw runtimeOutputError(`Runtime output has too few items at ${path}`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) throw runtimeOutputError(`Runtime output has too many items at ${path}`);
    value.forEach((item, index) => validateValueAgainstSchema(item, schema.items, `${path}[${index}]`));
  } else if (schema.type === 'string') {
    if (typeof value !== 'string') throw runtimeOutputError(`Runtime output expected string at ${path}`);
    if (schema.minLength !== undefined && value.length < schema.minLength) throw runtimeOutputError(`Runtime output string is too short at ${path}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) throw runtimeOutputError(`Runtime output string is too long at ${path}`);
  } else if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') throw runtimeOutputError(`Runtime output expected boolean at ${path}`);
  } else if (schema.type === 'number' || schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (schema.type === 'integer' && !Number.isInteger(value))) {
      throw runtimeOutputError(`Runtime output expected ${schema.type} at ${path}`);
    }
    if (schema.minimum !== undefined && value < schema.minimum) throw runtimeOutputError(`Runtime output is below minimum at ${path}`);
    if (schema.maximum !== undefined && value > schema.maximum) throw runtimeOutputError(`Runtime output is above maximum at ${path}`);
  }
  return value;
}

export function runtimeOutputSchemaForClaim(claim) {
  if (!isRecord(claim?.contract) || claim.contract.advisoryOnly !== true
    || (claim.contract.agentId !== undefined && claim.contract.agentId !== claim.agentId)
    || claim.advisoryOnly !== true || !isRecord(claim.contract.outputSchema)) {
    throw new OpenAiWorkerError('Runtime claim omitted a valid advisory output contract', { code: 'RUNTIME_OUTPUT_SCHEMA_REQUIRED' });
  }
  const schema = structuredClone(claim.contract.outputSchema);
  const evidenceKeys = Object.keys(claim.evidencePayload || {}).filter((key) => typeof key === 'string' && key.length > 0);
  const restrictEvidenceRefs = (collection) => {
    if (evidenceKeys.length > 0 && collection?.items?.properties?.evidenceRefs?.items) {
      collection.items.properties.evidenceRefs.items = { type: 'string', enum: evidenceKeys };
    }
  };
  if (evidenceKeys.length > 0 && schema.properties?.evidenceRefs?.items) {
    schema.properties.evidenceRefs.items = { type: 'string', enum: evidenceKeys };
  }
  restrictEvidenceRefs(schema.properties?.missions);
  restrictEvidenceRefs(schema.properties?.delegations);
  if (claim.agentId === 'systems-manager-ai-v1' && schema.properties?.actionableRisks?.items?.properties) {
    const assets = Array.isArray(claim.evidencePayload?.assets) ? claim.evidencePayload.assets : [];
    const risks = Array.isArray(claim.evidencePayload?.risks) ? claim.evidencePayload.risks : [];
    const assetIds = [...new Set(assets.map((item) => item?.assetId).filter((value) => typeof value === 'string' && value.length > 0))];
    const riskIds = [...new Set(risks
      .filter((item) => item?.classification === 'ACTION_REQUIRED')
      .map((item) => item?.riskId)
      .filter((value) => typeof value === 'string' && value.length > 0))];
    if (assetIds.length === 0 || riskIds.length === 0) {
      schema.properties.actionableRisks.maxItems = 0;
    } else {
      schema.properties.actionableRisks.items.properties.assetId = { type: 'string', enum: assetIds };
      schema.properties.actionableRisks.items.properties.riskId = { type: 'string', enum: riskIds };
    }
    restrictEvidenceRefs(schema.properties.actionableRisks);
  }
  validateRuntimeSchemaDefinition(schema);
  return schema;
}

function verifyEvidenceReferences(value, allowedEvidenceKeys, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((nested, index) => verifyEvidenceReferences(nested, allowedEvidenceKeys, `${path}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    if (key === 'evidenceRefs') {
      if (!Array.isArray(nested) || nested.some((reference) => typeof reference !== 'string' || !allowedEvidenceKeys.has(reference))) {
        throw runtimeOutputError(`Runtime output references evidence outside the closed snapshot at ${path}.${key}`);
      }
    }
    verifyEvidenceReferences(nested, allowedEvidenceKeys, `${path}.${key}`);
  }
}

export function validateRuntimeContractOutput(claim, value) {
  const schema = runtimeOutputSchemaForClaim(claim);
  validateValueAgainstSchema(value, schema);
  verifyEvidenceReferences(value, new Set(Object.keys(claim.evidencePayload || {})));
  const minimumConfidence = Number(claim.contract?.lowConfidencePolicy?.minConfidence);
  if (Number.isFinite(minimumConfidence) && typeof value.confidence === 'number'
    && value.confidence < minimumConfidence && value.needsHumanDecision !== true) {
    throw runtimeOutputError('Runtime output with low confidence must require a human decision');
  }
  return value;
}

function retryableStatus(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

export function advisoryRequestBody(claim, { model = 'gpt-5.6-sol', requireClaimOutputSchema = false } = {}) {
  const systemsManager = claim.agentId === 'systems-manager-ai-v1';
  const runtimeSchema = requireClaimOutputSchema ? runtimeOutputSchemaForClaim(claim) : null;
  const confidenceThreshold = Number(claim.contract?.lowConfidencePolicy?.minConfidence);
  const runtimePolicy = runtimeSchema
    ? ` Follow the signed runtime output contract exactly. Set needsHumanDecision=true whenever confidence is below ${Number.isFinite(confidenceThreshold) ? confidenceThreshold : 0.75}.`
    : '';
  return {
    model,
    store: false,
    reasoning: { effort: 'low' },
    max_output_tokens: claim.budgets?.maxOutputTokens || 3000,
    input: [
      {
        role: 'system',
        content: (systemsManager
          ? 'You are Gerente de Sistemas AI (systems-manager-ai-v1), reporting to general-manager-ai-v3 inside Company OS. Analyze only the supplied closed technical evidence. Distinguish a confirmed risk from a coverage gap. Never execute, claim execution, mutate business or infrastructure data, deploy, rotate credentials, expose secrets, or infer OFFLINE from missing telemetry. Deterministic risk classifications and scores in evidence are authoritative. Return at most five ACTION_REQUIRED risks. Every mission must remain PLANNED.'
          : 'You are Company OS V3. Produce advisory analysis only. Never execute, claim execution, change business data, send messages, buy, pay, price, deploy, or expose secrets. Use only supplied evidence references. Every mission must remain PLANNED.') + runtimePolicy,
      },
      {
        role: 'user',
        content: JSON.stringify({
          caseId: claim.caseId,
          agentId: claim.agentId || 'general-manager-ai-v3',
          objective: claim.objective,
          evidencePayload: claim.evidencePayload,
          contextMessages: claim.contextMessages || [],
        }),
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: runtimeSchema ? 'company_os_runtime_advisory' : 'company_os_v3_advisory',
        strict: true,
        schema: runtimeSchema || (systemsManager ? systemsAdvisoryOutputSchemaFor(claim.evidencePayload) : advisoryOutputSchemaFor(claim.evidencePayload)),
      },
    },
  };
}

export function advisoryRulesForClaim(claim, requireClaimOutputSchema = false) {
  return requireClaimOutputSchema
    ? [`${claim.agentId}@${claim.contractVersion || claim.contract?.version || 'unknown'}`, 'signed-runtime-contract', 'closed-evidence-only', 'advisory-only']
    : claim.agentId === 'systems-manager-ai-v1'
      ? ['systems-manager-ai-v1.0.0','closed-evidence-only','advisory-only','max-five-action-required']
      : ['general-manager-ai-v3','closed-evidence-only','advisory-only'];
}

export class OpenAiAdvisoryClient {
  constructor({ apiKey, baseUrl = 'https://api.openai.com/v1', model = 'gpt-5.6-sol', timeoutMs = 120_000, requireClaimOutputSchema = false, fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.requireClaimOutputSchema = requireClaimOutputSchema;
    this.fetchImpl = fetchImpl;
    this.sleep = sleep;
  }

  requestBody(claim) {
    return advisoryRequestBody(claim, {
      model: this.model,
      requireClaimOutputSchema: this.requireClaimOutputSchema,
    });
  }

  async generate(claim, { signal: externalSignal, deadlineAt = null } = {}) {
    let lastError;
    const startedAt = Date.now();
    const claimTimeoutMs = Number.isSafeInteger(claim.timeoutMs) && claim.timeoutMs > 0 ? claim.timeoutMs : this.timeoutMs;
    const localDeadline = startedAt + Math.min(this.timeoutMs, claimTimeoutMs);
    const runtimeDeadline = this.requireClaimOutputSchema
      ? Math.min(localDeadline, Number.isFinite(deadlineAt) ? deadlineAt : localDeadline)
      : null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const controller = new AbortController();
      const abortFromCaller = () => controller.abort();
      if (externalSignal?.aborted) controller.abort();
      else externalSignal?.addEventListener('abort', abortFromCaller, { once: true });
      const attemptTimeoutMs = runtimeDeadline === null
        ? Math.min(this.timeoutMs, claimTimeoutMs)
        : runtimeDeadline - Date.now();
      if (attemptTimeoutMs <= 0) throw new OpenAiWorkerError('OpenAI request timed out', { retryable: true, code: 'OPENAI_TIMEOUT' });
      const timer = setTimeout(() => controller.abort(), attemptTimeoutMs);
      timer.unref?.();
      try {
        const response = await this.fetchImpl(`${this.baseUrl}/responses`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            'content-type': 'application/json',
            'idempotency-key': `company-os-runtime:${claim.attemptId || claim.requestId}`,
          },
          body: JSON.stringify(this.requestBody(claim)),
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new OpenAiWorkerError(`OpenAI returned HTTP ${response.status}`, {
            retryable: retryableStatus(response.status),
            code: 'OPENAI_HTTP_ERROR',
            status: response.status,
          });
        }
        const raw = await response.json();
        if (!raw.usage || typeof raw.usage !== 'object' || Array.isArray(raw.usage)) {
          throw new OpenAiWorkerError('OpenAI response omitted usage', { code: 'OPENAI_MISSING_USAGE' });
        }
        const usage = {
          ...raw.usage,
          provider: 'openai',
          model: this.model,
          response_id: typeof raw.id === 'string' ? raw.id : null,
          duration_ms: Date.now() - startedAt,
          retry_count: attempt - 1,
          snapshot_bytes: Buffer.byteLength(JSON.stringify(claim.evidencePayload ?? {}), 'utf8'),
          rules_applied: advisoryRulesForClaim(claim, this.requireClaimOutputSchema),
        };
        let parsed;
        try {
          parsed = JSON.parse(outputText(raw));
        } catch (error) {
          const failure = error instanceof OpenAiWorkerError
            ? error
            : new OpenAiWorkerError('OpenAI returned invalid JSON output', { code: 'OPENAI_INVALID_JSON' });
          failure.usage = usage;
          throw failure;
        }
        let output;
        try {
          output = this.requireClaimOutputSchema
            ? validateRuntimeContractOutput(claim, parsed)
            : claim.agentId === 'systems-manager-ai-v1'
              ? validateSystemsAdvisoryOutput(parsed)
              : validateAdvisoryOutput(parsed);
        } catch (error) {
          if (error instanceof OpenAiWorkerError) error.usage = usage;
          throw error;
        }
        return {
          output,
          usage,
        };
      } catch (error) {
        const normalized = error?.name === 'AbortError'
          ? externalSignal?.aborted
            ? new OpenAiWorkerError('OpenAI request aborted by runtime lease control', { retryable: false, code: 'OPENAI_ABORTED' })
            : new OpenAiWorkerError('OpenAI request timed out', { retryable: true, code: 'OPENAI_TIMEOUT' })
          : error instanceof OpenAiWorkerError
            ? error
            : new OpenAiWorkerError('OpenAI network request failed', { retryable: true, code: 'OPENAI_NETWORK_ERROR' });
        lastError = normalized;
        if (attempt === 2 || !normalized.retryable) {
          normalized.attempts = attempt;
          normalized.retryCount = attempt - 1;
          throw normalized;
        }
        const retryDelayMs = runtimeDeadline === null ? 250 : Math.min(250, Math.max(0, runtimeDeadline - Date.now()));
        if (retryDelayMs <= 0) {
          normalized.attempts = attempt;
          normalized.retryCount = attempt - 1;
          throw normalized;
        }
        await this.sleep(retryDelayMs);
      } finally {
        clearTimeout(timer);
        externalSignal?.removeEventListener('abort', abortFromCaller);
      }
    }
    throw lastError;
  }
}
