import { NextResponse } from 'next/server';
import { heartbeatCompanyOsRuntimeWork } from '@/lib/company-os/runtime-store';
import { requiredString, verifiedRuntimeJson } from '../_request';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const verified = await verifiedRuntimeJson(request);
  if ('error' in verified) return verified.error;
  const keys = ['workerId', 'instanceId', 'workItemId', 'requestId', 'leaseToken'] as const;
  const values = Object.fromEntries(keys.map((key) => [key, requiredString(verified.input, key)])) as Record<typeof keys[number], string | null>;
  if (Object.values(values).some((value) => !value)) return NextResponse.json({ error: 'Heartbeat incompleto' }, { status: 400 });
  try {
    const result = await heartbeatCompanyOsRuntimeWork({
      workerId: values.workerId!, instanceId: values.instanceId!, workItemId: values.workItemId!,
      requestId: values.requestId!, leaseToken: values.leaseToken!,
      phase: typeof verified.input.phase === 'string' ? verified.input.phase : 'RUNNING',
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Heartbeat rechazado' }, { status: 409 });
  }
}
