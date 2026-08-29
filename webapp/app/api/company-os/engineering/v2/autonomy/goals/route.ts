import { NextResponse } from 'next/server';
import { listActiveEngineeringGoals } from '@/lib/company-os/engineering-store';
import { engineeringError, requiredString, verifiedRuntimeJson } from '../../_request';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const verified = await verifiedRuntimeJson(request);
  if ('error' in verified) return verified.error;
  const workerId = requiredString(verified.input, 'workerId');
  const instanceId = requiredString(verified.input, 'instanceId');
  if (!workerId || !instanceId) return NextResponse.json({ error: 'Identidad incompleta' }, { status: 400 });
  try {
    return NextResponse.json(await listActiveEngineeringGoals(verified.input.cursor), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return engineeringError(error);
  }
}
