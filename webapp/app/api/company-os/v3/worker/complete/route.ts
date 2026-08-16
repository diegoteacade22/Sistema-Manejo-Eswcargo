import { NextResponse } from 'next/server';
import { completeCompanyOsCase } from '@/lib/company-os/v3-store';
import type { CompanyOsWorkerResult, CompanyOsWorkerUsage } from '@/lib/company-os/v3-types';
import { verifiedWorkerJson } from '../_request';

function integer(value: unknown) {
  return Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0;
}

function normalizeUsage(raw: Record<string, unknown>): CompanyOsWorkerUsage {
  const inputDetails = (raw.input_tokens_details ?? {}) as Record<string, unknown>;
  const outputDetails = (raw.output_tokens_details ?? {}) as Record<string, unknown>;
  return {
    provider: 'openai',
    model: String(raw.model ?? process.env.COMPANY_OS_V3_MODEL ?? 'gpt-5.6-sol'),
    inputTokens: integer(raw.input_tokens),
    cachedTokens: integer(inputDetails.cached_tokens),
    cacheWriteTokens: integer(inputDetails.cache_write_tokens),
    outputTokens: integer(raw.output_tokens),
    reasoningTokens: integer(outputDetails.reasoning_tokens),
    totalTokens: integer(raw.total_tokens),
  };
}

export async function POST(request: Request) {
  const verified = await verifiedWorkerJson(request);
  if ('error' in verified) return verified.error;
  const { requestId, leaseToken, output, usage } = verified.input;
  if (typeof requestId !== 'string' || typeof leaseToken !== 'string' || !output || !usage) {
    return NextResponse.json({ error: 'Resultado incompleto' }, { status: 400 });
  }
  try {
    const result = await completeCompanyOsCase({
      requestId, leaseToken, result: output as CompanyOsWorkerResult,
      usage: normalizeUsage(usage as Record<string, unknown>),
    });
    return NextResponse.json({ ...result, businessWrites: 0 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Resultado rechazado' }, { status: 409 });
  }
}

