import { NextResponse } from 'next/server';
import { receiveAndCompleteCompanyOsRuntimeWork } from '@/lib/company-os/runtime-store';
import { normalizeRuntimeUsage, requiredString, verifiedRuntimeJson } from '../_request';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  const verified = await verifiedRuntimeJson(request);
  if ('error' in verified) return verified.error;
  const keys = ['workerId', 'instanceId', 'workItemId', 'requestId', 'leaseToken'] as const;
  const values = Object.fromEntries(keys.map((key) => [key, requiredString(verified.input, key)])) as Record<typeof keys[number], string | null>;
  if (Object.values(values).some((value) => !value) || !verified.input.output || !verified.input.usage) {
    return NextResponse.json({ error: 'Resultado incompleto' }, { status: 400 });
  }
  try {
    const result = await receiveAndCompleteCompanyOsRuntimeWork({
      workerId: values.workerId!, instanceId: values.instanceId!, workItemId: values.workItemId!,
      requestId: values.requestId!, leaseToken: values.leaseToken!, output: verified.input.output,
      attemptId: requiredString(verified.input, 'attemptId') ?? undefined,
      leaseInstanceId: requiredString(verified.input, 'leaseInstanceId') ?? undefined,
      usage: normalizeRuntimeUsage(verified.input.usage),
    });
    return NextResponse.json({ ...result, businessWrites: 0, infrastructureWrites: 0 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Resultado rechazado' }, { status: 409 });
  }
}
