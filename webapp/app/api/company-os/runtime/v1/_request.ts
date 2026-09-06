import { NextResponse } from 'next/server';
import { verifyCompanyOsRuntimeRequest } from '@/lib/company-os/v3-auth';
import {
  acceptCompanyOsRuntimeNonce,
  CompanyOsRuntimeRequestError,
} from '@/lib/company-os/runtime-store';
import type { CompanyOsWorkerUsage } from '@/lib/company-os/v3-types';

const MAX_BODY_BYTES = 1_048_576;

export async function verifiedRuntimeJson(request: Request) {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.startsWith('application/json')) {
    return { error: NextResponse.json({ error: 'Content-Type debe ser application/json' }, { status: 415 }) } as const;
  }
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return { error: NextResponse.json({ error: 'Body demasiado grande' }, { status: 413 }) } as const;
  }
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
    return { error: NextResponse.json({ error: 'Body demasiado grande' }, { status: 413 }) } as const;
  }
  const auth = verifyCompanyOsRuntimeRequest(request, rawBody);
  if (!auth) return { error: NextResponse.json({ error: 'Firma HMAC v2 inválida' }, { status: 401 }) } as const;
  let input: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawBody || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required');
    input = parsed as Record<string, unknown>;
  } catch {
    return { error: NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) } as const;
  }
  if (input.workerId !== auth.workerId || typeof input.instanceId !== 'string' || !input.instanceId.trim()) {
    return { error: NextResponse.json({ error: 'Identidad del worker no coincide con la firma' }, { status: 401 }) } as const;
  }
  try {
    await acceptCompanyOsRuntimeNonce(auth.workerId, auth.nonce, new URL(request.url).pathname);
  } catch (error) {
    if (error instanceof CompanyOsRuntimeRequestError) {
      return { error: NextResponse.json({ error: error.message }, { status: error.status }) } as const;
    }
    console.error('[Company OS Runtime] nonce persistence failed', error instanceof Error ? error.message : 'unknown');
    return { error: NextResponse.json({ error: 'No se pudo verificar anti-replay' }, { status: 503 }) } as const;
  }
  return { input, auth } as const;
}

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

export function normalizeRuntimeUsage(raw: unknown): CompanyOsWorkerUsage {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const inputDetails = source.input_tokens_details && typeof source.input_tokens_details === 'object'
    ? source.input_tokens_details as Record<string, unknown> : {};
  const outputDetails = source.output_tokens_details && typeof source.output_tokens_details === 'object'
    ? source.output_tokens_details as Record<string, unknown> : {};
  const rules = source.rulesApplied ?? source.rules_applied;
  const provider = source.provider === 'ollama' ? 'ollama' : 'openai';
  return {
    provider,
    usageKnown: source.usageKnown !== false && source.usage_known !== false,
    model: String(source.model ?? (provider === 'ollama' ? 'qwen3:14b-q4_K_M' : process.env.COMPANY_OS_V3_MODEL ?? 'gpt-5.6-sol')),
    inputTokens: integer(source.inputTokens ?? source.input_tokens),
    cachedTokens: integer(source.cachedTokens ?? inputDetails.cached_tokens),
    cacheWriteTokens: integer(source.cacheWriteTokens ?? inputDetails.cache_write_tokens),
    outputTokens: integer(source.outputTokens ?? source.output_tokens),
    reasoningTokens: integer(source.reasoningTokens ?? outputDetails.reasoning_tokens),
    totalTokens: integer(source.totalTokens ?? source.total_tokens),
    responseId: typeof (source.responseId ?? source.response_id) === 'string' ? String(source.responseId ?? source.response_id).slice(0, 200) : null,
    durationMs: integer(source.durationMs ?? source.duration_ms),
    retries: integer(source.retries ?? source.retry_count),
    snapshotBytes: integer(source.snapshotBytes ?? source.snapshot_bytes),
    rulesApplied: Array.isArray(rules)
      ? rules.filter((item): item is string => typeof item === 'string').slice(0, 30)
      : [],
  };
}

export function requiredString(input: Record<string, unknown>, key: string) {
  const value = input[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
