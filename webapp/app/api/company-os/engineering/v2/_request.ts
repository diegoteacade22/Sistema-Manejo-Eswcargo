import { NextResponse } from 'next/server';
import { ENGINEERING_MISSION_STATES, type EngineeringMissionState } from '@/lib/company-os/autonomous-engineering-v2';
import { EngineeringStoreError } from '@/lib/company-os/engineering-store';
import { requiredString, verifiedRuntimeJson } from '../../runtime/v1/_request';

export { requiredString, verifiedRuntimeJson };

export function engineeringIdentity(input: Record<string, unknown>) {
  const missionId = requiredString(input, 'missionId');
  const leaseId = requiredString(input, 'leaseId');
  let fencingToken: bigint | null = null;
  try {
    fencingToken = BigInt(String(input.fencingToken));
  } catch {}
  return missionId && leaseId && fencingToken && fencingToken > BigInt(0)
    ? { missionId, leaseId, fencingToken }
    : null;
}

export function missionState(value: unknown): EngineeringMissionState | null {
  return typeof value === 'string' && ENGINEERING_MISSION_STATES.includes(value as EngineeringMissionState)
    ? value as EngineeringMissionState
    : null;
}

export function engineeringError(error: unknown) {
  const status = error instanceof EngineeringStoreError ? error.status : 409;
  const code = error instanceof EngineeringStoreError ? error.code : 'ENGINEERING_REQUEST_REJECTED';
  const message = error instanceof Error ? error.message : 'Solicitud de ingeniería rechazada';
  return NextResponse.json({ error: message, code }, { status });
}
