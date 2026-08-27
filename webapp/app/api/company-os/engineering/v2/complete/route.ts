import { NextResponse } from 'next/server';
import { completeEngineeringMission } from '@/lib/company-os/engineering-store';
import { engineeringError, engineeringIdentity, verifiedRuntimeJson } from '../_request';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const verified = await verifiedRuntimeJson(request);
  if ('error' in verified) return verified.error;
  const identity = engineeringIdentity(verified.input);
  if (!identity || !verified.input.evidence || typeof verified.input.evidence !== 'object') {
    return NextResponse.json({ error: 'Resultado incompleto' }, { status: 400 });
  }
  try {
    return NextResponse.json(await completeEngineeringMission({ ...identity, evidence: verified.input.evidence }));
  } catch (error) {
    return engineeringError(error);
  }
}
