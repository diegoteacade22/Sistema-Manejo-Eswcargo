import { NextResponse } from 'next/server';
import { reconcileEngineeringEffect } from '@/lib/company-os/engineering-store';
import { engineeringError, engineeringIdentity, requiredString, verifiedRuntimeJson } from '../../_request';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const verified = await verifiedRuntimeJson(request);
  if ('error' in verified) return verified.error;
  const identity = engineeringIdentity(verified.input);
  const effectId = requiredString(verified.input, 'effectId');
  const outcome = verified.input.outcome === 'CONFIRMED' || verified.input.outcome === 'FAILED' ? verified.input.outcome : null;
  if (!identity || !effectId || !outcome) return NextResponse.json({ error: 'Reconciliación incompleta' }, { status: 400 });
  try {
    return NextResponse.json(await reconcileEngineeringEffect({
      ...identity, effectId, outcome,
      remoteProvider: requiredString(verified.input, 'remoteProvider') ?? undefined,
      remoteId: requiredString(verified.input, 'remoteId') ?? undefined,
      remoteUrl: requiredString(verified.input, 'remoteUrl') ?? undefined,
      remoteReadback: verified.input.remoteReadback,
      errorCode: requiredString(verified.input, 'errorCode') ?? undefined,
    }));
  } catch (error) {
    return engineeringError(error);
  }
}
