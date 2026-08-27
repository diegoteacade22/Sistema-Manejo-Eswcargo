import { NextResponse } from 'next/server';
import { transitionEngineeringMission } from '@/lib/company-os/engineering-store';
import { engineeringError, engineeringIdentity, missionState, requiredString, verifiedRuntimeJson } from '../_request';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const verified = await verifiedRuntimeJson(request);
  if ('error' in verified) return verified.error;
  const identity = engineeringIdentity(verified.input);
  const toStatus = missionState(verified.input.toStatus);
  const eventType = requiredString(verified.input, 'eventType');
  const idempotencyKey = requiredString(verified.input, 'idempotencyKey');
  const payload = verified.input.payload;
  if (!identity || !toStatus || !eventType || !idempotencyKey || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return NextResponse.json({ error: 'Transición incompleta' }, { status: 400 });
  }
  try {
    return NextResponse.json(await transitionEngineeringMission({
      ...identity, toStatus, eventType, idempotencyKey, payload,
    }));
  } catch (error) {
    return engineeringError(error);
  }
}
