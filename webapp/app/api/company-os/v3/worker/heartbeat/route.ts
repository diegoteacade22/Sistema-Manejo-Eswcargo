import { NextResponse } from 'next/server';
import { heartbeatCompanyOsCase } from '@/lib/company-os/v3-store';
import { verifiedWorkerJson } from '../_request';

export async function POST(request: Request) {
  const verified = await verifiedWorkerJson(request);
  if ('error' in verified) return verified.error;
  const { requestId, leaseToken } = verified.input;
  if (typeof requestId !== 'string' || typeof leaseToken !== 'string') return NextResponse.json({ error: 'Lease inválido' }, { status: 400 });
  try {
    const heartbeat = await heartbeatCompanyOsCase(requestId, leaseToken, 'MODEL_RUNNING');
    return NextResponse.json({ accepted: true, heartbeatId: heartbeat.id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Heartbeat rechazado' }, { status: 409 });
  }
}

