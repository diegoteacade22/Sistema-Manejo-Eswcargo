import { NextResponse } from 'next/server';
import { ENGINEERING_MISSION_STATES, type EngineeringMissionState } from '@/lib/company-os/autonomous-engineering-v2';
import { verifyCompanyOsEngineeringRequest } from '@/lib/company-os/v3-auth';
import {
  acceptCompanyOsRuntimeNonce,
  CompanyOsRuntimeRequestError,
} from '@/lib/company-os/runtime-store';
import { EngineeringStoreError } from '@/lib/company-os/engineering-store';
import { requiredString } from '../../runtime/v1/_request';

export { requiredString };

const MAX_BODY_BYTES = 1_048_576;

export async function verifiedEngineeringJson(request: Request) {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.startsWith('application/json')) {
    return { error: NextResponse.json({ error: 'Content-Type debe ser application/json' }, { status: 415 }) } as const;
  }
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return { error: NextResponse.json({ error: 'Body demasiado grande' }, { status: 413 }) } as const;
  }
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
    return { error: NextResponse.json({ error: 'Body demasiado grande' }, { status: 413 }) } as const;
  }
  const auth = verifyCompanyOsEngineeringRequest(request, rawBody);
  if (!auth) return { error: NextResponse.json({ error: 'Firma HMAC Engineering V2 inválida' }, { status: 401 }) } as const;
  let input: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawBody || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required');
    input = parsed as Record<string, unknown>;
  } catch {
    return { error: NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) } as const;
  }
  if (input.workerId !== auth.workerId || typeof input.instanceId !== 'string' || !input.instanceId.trim()) {
    return { error: NextResponse.json({ error: 'Identidad Engineering V2 no coincide con la firma' }, { status: 401 }) } as const;
  }
  try {
    await acceptCompanyOsRuntimeNonce(auth.workerId, auth.nonce, new URL(request.url).pathname);
  } catch (error) {
    if (error instanceof CompanyOsRuntimeRequestError) {
      return { error: NextResponse.json({ error: error.message }, { status: error.status }) } as const;
    }
    console.error('[Company OS Engineering V2] nonce persistence failed', error instanceof Error ? error.message : 'unknown');
    return { error: NextResponse.json({ error: 'No se pudo verificar anti-replay' }, { status: 503 }) } as const;
  }
  return { input, auth } as const;
}

// Existing Engineering V2 routes import this legacy local name. It now points
// exclusively at the domain-separated Engineering verifier above.
export const verifiedRuntimeJson = verifiedEngineeringJson;

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
