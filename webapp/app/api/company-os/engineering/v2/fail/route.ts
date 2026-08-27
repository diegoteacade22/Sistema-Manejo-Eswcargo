import { NextResponse } from 'next/server';
import { failEngineeringMission } from '@/lib/company-os/engineering-store';
import { engineeringError, engineeringIdentity, requiredString, verifiedRuntimeJson } from '../_request';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const verified = await verifiedRuntimeJson(request);
  if ('error' in verified) return verified.error;
  const identity = engineeringIdentity(verified.input);
  const errorCode = requiredString(verified.input, 'errorCode');
  if (!identity || !errorCode || typeof verified.input.retryable !== 'boolean') {
    return NextResponse.json({ error: 'Falla incompleta' }, { status: 400 });
  }
  try {
    return NextResponse.json(await failEngineeringMission({ ...identity, errorCode, retryable: verified.input.retryable }));
  } catch (error) {
    return engineeringError(error);
  }
}
