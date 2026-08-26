import { NextResponse } from 'next/server';
import { reconcileCompanyOsRuntime } from '@/lib/company-os/runtime-store';
import { requiredString, verifiedRuntimeJson } from '../_request';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const verified = await verifiedRuntimeJson(request);
  if ('error' in verified) return verified.error;
  const workerId = requiredString(verified.input, 'workerId');
  if (!workerId) return NextResponse.json({ error: 'workerId obligatorio' }, { status: 400 });
  try {
    return NextResponse.json(await reconcileCompanyOsRuntime(workerId), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[Company OS Runtime] reconcile failed', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'No se pudo reconciliar' }, { status: 503 });
  }
}
