import { NextResponse } from 'next/server';
import { failCompanyOsRuntimeWork } from '@/lib/company-os/runtime-store';
import { normalizeRuntimeUsage, requiredString, verifiedRuntimeJson } from '../_request';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const verified = await verifiedRuntimeJson(request);
  if ('error' in verified) return verified.error;
  const keys = ['workerId', 'instanceId', 'workItemId', 'requestId', 'leaseToken', 'errorCode'] as const;
  const values = Object.fromEntries(keys.map((key) => [key, requiredString(verified.input, key)])) as Record<typeof keys[number], string | null>;
  if (Object.values(values).some((value) => !value)) return NextResponse.json({ error: 'Falla incompleta' }, { status: 400 });
  try {
    const result = await failCompanyOsRuntimeWork({
      workerId: values.workerId!, instanceId: values.instanceId!, workItemId: values.workItemId!,
      requestId: values.requestId!, leaseToken: values.leaseToken!, errorCode: values.errorCode!,
      detail: typeof verified.input.detail === 'string' ? verified.input.detail : 'Runtime failure',
      retryable: verified.input.retryable !== false,
      usage: verified.input.usage ? normalizeRuntimeUsage(verified.input.usage) : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Falla rechazada' }, { status: 409 });
  }
}
