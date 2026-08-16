import { NextResponse } from 'next/server';
import { claimCompanyOsCase } from '@/lib/company-os/v3-store';
import { verifiedWorkerJson } from '../_request';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const verified = await verifiedWorkerJson(request);
  if ('error' in verified) return verified.error;
  const requestId = typeof verified.input.requestId === 'string' ? verified.input.requestId : undefined;
  try {
    const claim = await claimCompanyOsCase(requestId);
    if (!claim) return new NextResponse(null, { status: 204 });
    return NextResponse.json(claim, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[Company OS V3] claim failed', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'No se pudo reclamar el caso' }, { status: 503 });
  }
}

