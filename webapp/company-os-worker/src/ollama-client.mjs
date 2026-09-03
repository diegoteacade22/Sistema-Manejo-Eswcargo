import {
  advisoryRequestBody,
  advisoryRulesForClaim,
  dataAdvisoryOutputSchemaFor,
  validateAdvisoryOutput,
  validateRuntimeContractOutput,
  validateSystemsAdvisoryOutput,
  validateDataAdvisoryOutput,
} from './openai-client.mjs';
import { requiresLocalInference } from './data-policy.mjs';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]']);
const DEFAULT_FALLBACK_RESERVE_MS = 30_000;
const CONCISE_LOCAL_OUTPUT_RULE = ' Respond in Spanish with one complete compact JSON object. Keep explanatory fields to one short sentence and titles brief. Cover every material finding once; avoid repeating evidence or facts across fields. Summarize healthy coverage; never reproduce the source inventory or create a finding for every healthy source. Preserve all required fields, confidence rules and material findings; never invent facts to fill the schema.';

export function localDecodingSchema(schema, evidencePayload) {
  const copy = structuredClone(schema);
  const evidenceCount = Object.keys(evidencePayload ?? {}).length;
  function narrow(node, key = '') {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'string' && !node.enum && node.const === undefined) {
      const preferred = key === 'title' ? 120 : /Id$/.test(key) ? 80 : 240;
      const limit = Math.max(node.minLength ?? 0, preferred);
      node.maxLength = Math.min(node.maxLength ?? limit, limit);
    }
    if (node.type === 'array') {
      const preferred = key === 'evidenceRefs' ? evidenceCount : key === 'missions' ? 10 : null;
      if (preferred !== null) {
        const limit = Math.max(node.minItems ?? 0, preferred);
        node.maxItems = Math.min(node.maxItems ?? limit, limit);
      }
      narrow(node.items, key);
    }
    for (const [childKey, child] of Object.entries(node.properties ?? {})) narrow(child, childKey);
  }
  narrow(copy);
  return copy;
}

export class OllamaWorkerError extends Error {
  constructor(message, { retryable = false, code = 'OLLAMA_ERROR', status = null } = {}) {
    super(message);
    this.name = 'OllamaWorkerError';
    this.retryable = retryable;
    this.code = code;
    this.status = Number.isInteger(status) ? status : null;
  }
}

export class ModelRouterFallbackError extends Error {
  constructor({ primaryCode, fallbackCode, retries, durationMs, retryable, usage }) {
    super(`Model router fallback failed: primary=${primaryCode}; fallback=${fallbackCode}`);
    this.name = 'ModelRouterFallbackError';
    this.code = 'MODEL_ROUTER_FALLBACK_FAILED';
    this.primaryCode = primaryCode;
    this.fallbackCode = fallbackCode;
    this.retries = retries;
    this.durationMs = durationMs;
    this.retryable = retryable;
    this.usage = usage;
  }
}

export function validateOllamaBaseUrl(rawValue) {
  const url = new URL(rawValue);
  if (url.protocol !== 'http:' || url.username || url.password
    || (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash
    || !LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('COMPANY_OS_RUNTIME_OLLAMA_BASE_URL must be a pure HTTP loopback origin');
  }
  return url.origin;
}

function retryableOllamaStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

function parseOllamaOutput(raw) {
  const content = raw?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new OllamaWorkerError('Ollama response contained no output text', { code: 'OLLAMA_EMPTY_OUTPUT' });
  }
  try {
    return JSON.parse(content);
  } catch {
    throw new OllamaWorkerError('Ollama returned invalid JSON output', { code: 'OLLAMA_INVALID_JSON' });
  }
}

function nonNegativeInteger(value) {
  const candidate = Number(value);
  return Number.isSafeInteger(candidate) && candidate >= 0 ? candidate : 0;
}

function safeProviderErrorCode(value, fallback) {
  return typeof value === 'string' && /^[A-Z0-9_]{1,80}$/.test(value) ? value : fallback;
}

export class OllamaAdvisoryClient {
  constructor({
    baseUrl = 'http://127.0.0.1:11434',
    model = 'qwen3:14b-q4_K_M',
    timeoutMs = 120_000,
    requireClaimOutputSchema = true,
    fetchImpl = globalThis.fetch,
    now = Date.now,
  } = {}) {
    this.baseUrl = validateOllamaBaseUrl(baseUrl);
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.requireClaimOutputSchema = requireClaimOutputSchema;
    this.fetchImpl = fetchImpl;
    this.now = now;
  }

  requestBody(claim) {
    if (claim.agentId === 'data-manager-ai-v1') {
      const runtimePolicy = claim.contract?.lowConfidencePolicy?.minConfidence
        ? ` Follow the signed runtime output contract exactly. Set needsHumanDecision=true whenever confidence is below ${claim.contract.lowConfidencePolicy.minConfidence}.`
        : '';
      return {
        model: this.model,
        messages: [
          {
            role: 'system',
            content: 'You are Gerente de Datos AI (data-manager-ai-v1), reporting to general-manager-ai-v3 inside Company OS. Analyze only the supplied closed business snapshot. Identify data quality, freshness, consistency, and coverage findings with evidence references. Review every quality metric: each nonzero duplicate, missing-value or inconsistent-record count and each material freshness gap needs a finding; a higher-priority issue does not erase the others. Never execute, claim execution, change, delete, import, or expose business data. Every mission must remain PLANNED.' + runtimePolicy + CONCISE_LOCAL_OUTPUT_RULE,
          },
          {
            role: 'user',
            content: JSON.stringify({
              caseId: claim.caseId,
              agentId: claim.agentId,
              objective: claim.objective,
              evidencePayload: claim.evidencePayload,
              contextMessages: claim.contextMessages || [],
            }),
          },
        ],
        stream: false,
        think: false,
        format: localDecodingSchema(dataAdvisoryOutputSchemaFor(claim.evidencePayload), claim.evidencePayload),
        options: {
          temperature: 0,
          num_predict: claim.budgets?.maxOutputTokens || 3000,
        },
      };
    }
    const advisory = advisoryRequestBody(claim, {
      model: this.model,
      requireClaimOutputSchema: this.requireClaimOutputSchema,
    });
    return {
      model: this.model,
      messages: requiresLocalInference(claim)
        ? [...advisory.input, { role: 'system', content: CONCISE_LOCAL_OUTPUT_RULE }]
        : advisory.input,
      stream: false,
      think: false,
      format: requiresLocalInference(claim)
        ? localDecodingSchema(advisory.text.format.schema, claim.evidencePayload)
        : advisory.text.format.schema,
      options: {
        temperature: 0,
        num_predict: advisory.max_output_tokens,
      },
    };
  }

  async generate(claim, { signal: externalSignal, deadlineAt = null } = {}) {
    const startedAt = this.now();
    const claimTimeoutMs = Number.isSafeInteger(claim.timeoutMs) && claim.timeoutMs > 0 ? claim.timeoutMs : this.timeoutMs;
    const localDeadline = startedAt + Math.min(this.timeoutMs, claimTimeoutMs);
    const effectiveDeadline = Math.min(localDeadline, Number.isFinite(deadlineAt) ? deadlineAt : localDeadline);
    const remainingMs = effectiveDeadline - this.now();
    if (remainingMs <= 0) {
      throw new OllamaWorkerError('Ollama fallback deadline was already exhausted', {
        retryable: true,
        code: 'OLLAMA_TIMEOUT',
      });
    }
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort();
    if (externalSignal?.aborted) controller.abort();
    else externalSignal?.addEventListener('abort', abortFromCaller, { once: true });
    const timer = setTimeout(() => controller.abort(), remainingMs);
    timer.unref?.();
    let usage;
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(this.requestBody(claim)),
        signal: controller.signal,
        redirect: 'error',
      });
      if (!response.ok) {
        throw new OllamaWorkerError(`Ollama returned HTTP ${response.status}`, {
          retryable: retryableOllamaStatus(response.status),
          code: 'OLLAMA_HTTP_ERROR',
          status: response.status,
        });
      }
      const raw = await response.json();
      if (raw?.model !== this.model) {
        throw new OllamaWorkerError('Ollama response model does not match the configured model', { code: 'OLLAMA_MODEL_MISMATCH' });
      }
      if (raw?.done !== true) {
        throw new OllamaWorkerError('Ollama response was not a completed generation', { code: 'OLLAMA_INCOMPLETE_RESPONSE' });
      }
      const inputTokens = nonNegativeInteger(raw?.prompt_eval_count);
      const outputTokens = nonNegativeInteger(raw?.eval_count);
      usage = {
        provider: 'ollama',
        model: this.model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
        response_id: null,
        duration_ms: Number.isFinite(Number(raw?.total_duration))
          ? Math.max(0, Math.round(Number(raw.total_duration) / 1_000_000))
          : this.now() - startedAt,
        retry_count: 0,
        snapshot_bytes: Buffer.byteLength(JSON.stringify(claim.evidencePayload ?? {}), 'utf8'),
        rules_applied: [
          ...advisoryRulesForClaim(claim, this.requireClaimOutputSchema),
          'local-loopback-inference',
          requiresLocalInference(claim) ? 'data-manager-lineage-local-only' : 'openai-retryable-fallback-only',
        ],
      };
      const parsed = parseOllamaOutput(raw);
      let output;
      try {
        output = this.requireClaimOutputSchema
          ? validateRuntimeContractOutput(claim, parsed)
          : claim.agentId === 'systems-manager-ai-v1'
            ? validateSystemsAdvisoryOutput(parsed)
            : claim.agentId === 'data-manager-ai-v1'
              ? validateDataAdvisoryOutput(parsed)
            : validateAdvisoryOutput(parsed);
      } catch (error) {
        const validationError = new OllamaWorkerError('Ollama output violated the signed runtime contract', {
          retryable: false,
          code: 'OLLAMA_INVALID_RUNTIME_OUTPUT',
        });
        validationError.cause = error;
        validationError.usage = usage;
        throw validationError;
      }
      return { output, usage };
    } catch (error) {
      const normalized = error?.name === 'AbortError'
        ? externalSignal?.aborted
          ? new OllamaWorkerError('Ollama request aborted by runtime lease control', { retryable: false, code: 'OLLAMA_ABORTED' })
          : new OllamaWorkerError('Ollama request timed out', { retryable: true, code: 'OLLAMA_TIMEOUT' })
        : error instanceof OllamaWorkerError
          ? error
          : new OllamaWorkerError('Ollama network request failed', { retryable: true, code: 'OLLAMA_NETWORK_ERROR' });
      if (usage && !normalized.usage) normalized.usage = usage;
      throw normalized;
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', abortFromCaller);
    }
  }
}

export function isEligibleOpenAiFallback(error) {
  if (!error || error.retryable !== true) return false;
  if (error.code === 'OPENAI_NETWORK_ERROR' || error.code === 'OPENAI_TIMEOUT') return true;
  return error.code === 'OPENAI_HTTP_ERROR'
    && (error.status === 408 || error.status === 429 || (Number.isInteger(error.status) && error.status >= 500));
}

export class RetryableModelFallbackClient {
  constructor({
    primary,
    fallback,
    enabled = true,
    fallbackReserveMs = DEFAULT_FALLBACK_RESERVE_MS,
    now = Date.now,
  }) {
    if (!Number.isSafeInteger(fallbackReserveMs) || fallbackReserveMs <= 0) {
      throw new Error('fallbackReserveMs must be a positive integer');
    }
    this.primary = primary;
    this.fallback = fallback;
    this.enabled = enabled;
    this.fallbackReserveMs = fallbackReserveMs;
    this.now = now;
  }

  async generate(claim, options = {}) {
    const startedAt = this.now();
    const claimTimeoutMs = Number.isSafeInteger(claim.timeoutMs) && claim.timeoutMs > 0 ? claim.timeoutMs : 120_000;
    const deadlineAt = Number.isFinite(options.deadlineAt) ? options.deadlineAt : startedAt + claimTimeoutMs;
    const totalRemainingMs = Math.max(0, deadlineAt - startedAt);
    const fallbackReserveMs = this.enabled
      ? Math.min(this.fallbackReserveMs, Math.floor(totalRemainingMs / 2))
      : 0;
    const primaryDeadlineAt = deadlineAt - fallbackReserveMs;
    try {
      return await this.primary.generate(claim, { ...options, deadlineAt: primaryDeadlineAt });
    } catch (error) {
      if (!this.enabled || options.signal?.aborted || !isEligibleOpenAiFallback(error)) throw error;
      if (deadlineAt <= this.now()) {
        throw new OllamaWorkerError('Model router deadline exhausted before local fallback', {
          retryable: true,
          code: 'MODEL_ROUTER_TIMEOUT',
        });
      }
      try {
        const result = await this.fallback.generate(claim, { ...options, deadlineAt });
        const upstreamRetries = Number.isSafeInteger(error.retryCount) ? error.retryCount : 0;
        return {
          ...result,
          usage: {
            ...result.usage,
            retry_count: nonNegativeInteger(result.usage?.retry_count) + upstreamRetries + 1,
            duration_ms: Math.max(0, this.now() - startedAt),
            fallback_provider_duration_ms: nonNegativeInteger(result.usage?.duration_ms),
            fallback_from_provider: 'openai',
            fallback_reason: error.code,
          },
        };
      } catch (fallbackError) {
        if (options.signal?.aborted) throw fallbackError;
        const primaryCode = safeProviderErrorCode(error.code, 'OPENAI_UNKNOWN_ERROR');
        const fallbackCode = safeProviderErrorCode(fallbackError?.code, 'OLLAMA_UNKNOWN_ERROR');
        const primaryRetries = Number.isSafeInteger(error.retryCount) ? error.retryCount : 0;
        const fallbackRetries = Number.isSafeInteger(fallbackError?.retryCount)
          ? fallbackError.retryCount
          : nonNegativeInteger(fallbackError?.usage?.retry_count);
        const retries = primaryRetries + fallbackRetries + 1;
        const durationMs = Math.max(0, this.now() - startedAt);
        const fallbackUsage = fallbackError?.usage && typeof fallbackError.usage === 'object'
          ? fallbackError.usage
          : {};
        const rulesApplied = Array.isArray(fallbackUsage.rules_applied)
          ? fallbackUsage.rules_applied.filter((value) => typeof value === 'string').slice(0, 27)
          : [];
        throw new ModelRouterFallbackError({
          primaryCode,
          fallbackCode,
          retries,
          durationMs,
          retryable: error.retryable === true || fallbackError?.retryable === true,
          usage: {
            ...fallbackUsage,
            provider: 'ollama',
            model: typeof fallbackUsage.model === 'string' ? fallbackUsage.model : this.fallback.model || 'qwen-local',
            input_tokens: nonNegativeInteger(fallbackUsage.input_tokens),
            output_tokens: nonNegativeInteger(fallbackUsage.output_tokens),
            total_tokens: nonNegativeInteger(fallbackUsage.total_tokens),
            retry_count: retries,
            duration_ms: durationMs,
            response_id: typeof fallbackUsage.response_id === 'string' ? fallbackUsage.response_id : null,
            snapshot_bytes: nonNegativeInteger(fallbackUsage.snapshot_bytes),
            rules_applied: [...rulesApplied, 'model-router-fallback-failed', primaryCode, fallbackCode],
          },
        });
      }
    }
  }
}
