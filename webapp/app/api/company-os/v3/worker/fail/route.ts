import { NextResponse } from 'next/server';
import { failCompanyOsCase } from '@/lib/company-os/v3-store';
import { verifiedWorkerJson } from '../_request';

export async function POST(request: Request) {
  const verified = await verifiedWorkerJson(request);
  if ('error' in verified) return verified.error;
  const { requestId, leaseToken } = verified.input;
  const error = (verified.input.error ?? {}) as Record<string, unknown>;
  if (typeof requestId !== 'string' || typeof leaseToken !== 'string') return NextResponse.json({ error: 'Fallo incompleto' }, { status: 400 });
  try {
    const result = await failCompanyOsCase(requestId, leaseToken, String(error.code ?? 'WORKER_FAILURE'), String(error.message ?? 'Worker failed'));
    return NextResponse.json(result);
  } catch (caught) {
    return NextResponse.json({ error: caught instanceof Error ? caught.message : 'Fallo rechazado' }, { status: 409 });
  }
}

