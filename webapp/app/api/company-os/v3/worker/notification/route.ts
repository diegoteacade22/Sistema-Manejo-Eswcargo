import { NextResponse } from 'next/server';
import { recordCompanyOsNotification } from '@/lib/company-os/v3-store';
import { verifiedWorkerJson } from '../_request';

export async function POST(request: Request) {
  const verified = await verifiedWorkerJson(request);
  if ('error' in verified) return verified.error;
  const { requestId, leaseToken } = verified.input;
  const delivery = (verified.input.delivery ?? {}) as Record<string, unknown>;
  if (typeof requestId !== 'string' || typeof leaseToken !== 'string' || !['DELIVERED', 'FAILED'].includes(String(delivery.status))) {
    return NextResponse.json({ error: 'Entrega inválida' }, { status: 400 });
  }
  try {
    const result = await recordCompanyOsNotification({
      requestId, leaseToken, status: String(delivery.status) as 'DELIVERED' | 'FAILED',
      responseCode: typeof delivery.responseCode === 'number' ? delivery.responseCode : null,
      errorDetail: typeof delivery.error === 'object' && delivery.error
        ? String((delivery.error as Record<string, unknown>).message ?? '')
        : null,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo registrar la entrega' }, { status: 409 });
  }
}
