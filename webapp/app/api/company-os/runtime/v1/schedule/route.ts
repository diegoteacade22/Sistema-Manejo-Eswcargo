import { NextResponse } from 'next/server';
import { runDueCompanyOsSchedules } from '@/lib/company-os/v3-store';
import { requiredString, verifiedRuntimeJson } from '../_request';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  const verified = await verifiedRuntimeJson(request);
  if ('error' in verified) return verified.error;
  const workerId = requiredString(verified.input, 'workerId');
  if (!workerId) return NextResponse.json({ error: 'workerId obligatorio' }, { status: 400 });
  try {
    const results = await runDueCompanyOsSchedules(workerId);
    return NextResponse.json({ scheduled: results.length, results, modelCalls: 0 }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[Company OS Runtime] schedule failed', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'No se pudo evaluar la agenda' }, { status: 503 });
  }
}
