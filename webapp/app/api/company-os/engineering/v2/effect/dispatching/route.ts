import { NextResponse } from 'next/server';
import { markEngineeringEffectDispatching } from '@/lib/company-os/engineering-store';
import { engineeringError, engineeringIdentity, requiredString, verifiedRuntimeJson } from '../../_request';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const verified = await verifiedRuntimeJson(request);
  if ('error' in verified) return verified.error;
  const identity = engineeringIdentity(verified.input);
  const effectId = requiredString(verified.input, 'effectId');
  if (!identity || !effectId) return NextResponse.json({ error: 'Efecto incompleto' }, { status: 400 });
  try {
    return NextResponse.json(await markEngineeringEffectDispatching({ ...identity, effectId }));
  } catch (error) {
    return engineeringError(error);
  }
}
