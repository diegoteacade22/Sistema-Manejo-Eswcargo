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

export function advisoryOutputSchemaFor(evidencePayload) {
  const keys = Object.keys(evidencePayload || {}).filter((key) => typeof key === 'string' && key.length > 0);
  const schema = structuredClone(ADVISORY_OUTPUT_SCHEMA);
  schema.properties.evidenceRefs.items = { type: 'string', enum: keys };
  schema.properties.missions.items.properties.evidenceRefs.items = { type: 'string', enum: keys };
  return schema;
}

export class OpenAiWorkerError extends Error {
  constructor(message, { retryable = false, code = 'OPENAI_ERROR' } = {}) {
    super(message);
    this.name = 'OpenAiWorkerError';
    this.retryable = retryable;
    this.code = code;
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

function retryableStatus(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

export class OpenAiAdvisoryClient {
  constructor({ apiKey, baseUrl = 'https://api.openai.com/v1', model = 'gpt-5.6-sol', timeoutMs = 120_000, fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.sleep = sleep;
  }

  requestBody(claim) {
    return {
      model: this.model,
      store: false,
      reasoning: { effort: 'low' },
      max_output_tokens: claim.budgets?.maxOutputTokens || 3000,
      input: [
        {
          role: 'system',
          content: 'You are Company OS V3. Produce advisory analysis only. Never execute, claim execution, change business data, send messages, buy, pay, price, deploy, or expose secrets. Use only supplied evidence references. Every mission must remain PLANNED.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            caseId: claim.caseId,
            objective: claim.objective,
            evidencePayload: claim.evidencePayload,
            contextMessages: claim.contextMessages || [],
          }),
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'company_os_v3_advisory',
          strict: true,
          schema: advisoryOutputSchemaFor(claim.evidencePayload),
        },
      },
    };
  }

  async generate(claim) {
    let lastError;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      timer.unref?.();
      try {
        const response = await this.fetchImpl(`${this.baseUrl}/responses`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(this.requestBody(claim)),
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new OpenAiWorkerError(`OpenAI returned HTTP ${response.status}`, {
            retryable: retryableStatus(response.status),
            code: 'OPENAI_HTTP_ERROR',
          });
        }
        const raw = await response.json();
        let parsed;
        try {
          parsed = JSON.parse(outputText(raw));
        } catch (error) {
          if (error instanceof OpenAiWorkerError) throw error;
          throw new OpenAiWorkerError('OpenAI returned invalid JSON output', { code: 'OPENAI_INVALID_JSON' });
        }
        if (!raw.usage || typeof raw.usage !== 'object' || Array.isArray(raw.usage)) {
          throw new OpenAiWorkerError('OpenAI response omitted usage', { code: 'OPENAI_MISSING_USAGE' });
        }
        return { output: validateAdvisoryOutput(parsed), usage: raw.usage };
      } catch (error) {
        const normalized = error?.name === 'AbortError'
          ? new OpenAiWorkerError('OpenAI request timed out', { retryable: true, code: 'OPENAI_TIMEOUT' })
          : error instanceof OpenAiWorkerError
            ? error
            : new OpenAiWorkerError('OpenAI network request failed', { retryable: true, code: 'OPENAI_NETWORK_ERROR' });
        lastError = normalized;
        if (attempt === 2 || !normalized.retryable) throw normalized;
        await this.sleep(250);
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError;
  }
}
