import { NextResponse } from 'next/server';
import { EngineeringStoreError, heartbeatEngineeringMission, recordStaleFencingRejection } from '@/lib/company-os/engineering-store';
import { engineeringError, engineeringIdentity, verifiedRuntimeJson } from '../_request';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const verified = await verifiedRuntimeJson(request);
  if ('error' in verified) return verified.error;
  const identity = engineeringIdentity(verified.input);
  if (!identity) return NextResponse.json({ error: 'Capability incompleta' }, { status: 400 });
  try {
    return NextResponse.json(await heartbeatEngineeringMission({
      ...identity, phase: typeof verified.input.phase === 'string' ? verified.input.phase : 'RUNNING',
    }), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof EngineeringStoreError && error.code === 'STALE_FENCING_TOKEN') {
      await recordStaleFencingRejection(identity).catch(() => undefined);
    }
    return engineeringError(error);
  }
}
