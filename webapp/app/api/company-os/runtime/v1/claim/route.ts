import { NextResponse } from 'next/server';
import { claimCompanyOsRuntimeWork } from '@/lib/company-os/runtime-store';
import { requiredString, verifiedRuntimeJson } from '../_request';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const verified = await verifiedRuntimeJson(request);
  if ('error' in verified) return verified.error;
  const workerId = requiredString(verified.input, 'workerId');
  const instanceId = requiredString(verified.input, 'instanceId');
  if (!workerId || !instanceId) return NextResponse.json({ error: 'Identidad incompleta' }, { status: 400 });
  try {
    const claim = await claimCompanyOsRuntimeWork({ workerId, instanceId });
    if (!claim) return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
    return NextResponse.json(claim, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[Company OS Runtime] claim failed', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'No se pudo reclamar trabajo' }, { status: 503 });
  }
}
