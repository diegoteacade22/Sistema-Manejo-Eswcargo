import { NextResponse } from 'next/server';
import { getCompanyOsRuntimeResultStatus } from '@/lib/company-os/runtime-result-receipts';
import { requiredString, verifiedRuntimeJson } from '../_request';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const verified = await verifiedRuntimeJson(request);
  if ('error' in verified) return verified.error;
  const keys = ['workerId', 'instanceId', 'workItemId', 'requestId', 'leaseToken', 'attemptId'] as const;
  const fields = Object.fromEntries(keys.map((key) => [key, requiredString(verified.input, key)])) as Record<typeof keys[number], string>;
  if (Object.values(fields).some((value) => !value)) return NextResponse.json({ error: 'Identidad incompleta' }, { status: 400 });
  try {
    const status = await getCompanyOsRuntimeResultStatus({ ...fields,
      leaseInstanceId: requiredString(verified.input, 'leaseInstanceId') ?? undefined });
    return NextResponse.json(status);
  } catch {
    return NextResponse.json({ error: 'No se pudo verificar el resultado del intento' }, { status: 409 });
  }
}
