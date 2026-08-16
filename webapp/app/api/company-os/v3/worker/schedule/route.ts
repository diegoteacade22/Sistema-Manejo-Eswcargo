import { NextResponse } from 'next/server';
import { runDueCompanyOsSchedules } from '@/lib/company-os/v3-store';
import { verifiedWorkerJson } from '../_request';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  const verified = await verifiedWorkerJson(request);
  if ('error' in verified) return verified.error;
  if (Object.keys(verified.input).length > 0) return NextResponse.json({ error: 'Payload de agenda inválido' }, { status: 400 });
  try {
    const runs = await runDueCompanyOsSchedules();
    return NextResponse.json({ accepted: true, runs, infrastructureWrites: 0, businessWrites: 0 });
  } catch (error) {
    console.error('[Company OS V3] schedule failed', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'No se pudo procesar la agenda' }, { status: 503 });
  }
}
