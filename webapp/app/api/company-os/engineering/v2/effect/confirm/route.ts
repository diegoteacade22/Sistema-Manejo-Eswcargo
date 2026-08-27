import { NextResponse } from 'next/server';
import { confirmEngineeringEffect } from '@/lib/company-os/engineering-store';
import { engineeringError, engineeringIdentity, requiredString, verifiedRuntimeJson } from '../../_request';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const verified = await verifiedRuntimeJson(request);
  if ('error' in verified) return verified.error;
  const identity = engineeringIdentity(verified.input);
  const effectId = requiredString(verified.input, 'effectId');
  const remoteProvider = requiredString(verified.input, 'remoteProvider');
  const remoteId = requiredString(verified.input, 'remoteId');
  const remoteUrl = requiredString(verified.input, 'remoteUrl');
  if (!identity || !effectId || !remoteProvider || !remoteId || !remoteUrl || !verified.input.remoteReadback) {
    return NextResponse.json({ error: 'Readback incompleto' }, { status: 400 });
  }
  try {
    return NextResponse.json(await confirmEngineeringEffect({
      ...identity, effectId, remoteProvider, remoteId, remoteUrl, remoteReadback: verified.input.remoteReadback,
    }));
  } catch (error) {
    return engineeringError(error);
  }
}
