import { NextResponse } from 'next/server';
import { markEngineeringEffectUnknown } from '@/lib/company-os/engineering-store';
import { engineeringError, engineeringIdentity, requiredString, verifiedRuntimeJson } from '../../_request';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const verified = await verifiedRuntimeJson(request);
  if ('error' in verified) return verified.error;
  const identity = engineeringIdentity(verified.input);
  const effectId = requiredString(verified.input, 'effectId');
  const errorCode = requiredString(verified.input, 'errorCode');
  if (!identity || !effectId || !errorCode) return NextResponse.json({ error: 'Outcome incompleto' }, { status: 400 });
  try {
    return NextResponse.json(await markEngineeringEffectUnknown({ ...identity, effectId, errorCode }));
  } catch (error) {
    return engineeringError(error);
  }
}
