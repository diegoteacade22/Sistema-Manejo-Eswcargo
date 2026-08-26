import { NextResponse } from 'next/server';
import { hasTrustedHumanRequestOrigin, requireHumanCompanyAdmin } from '@/lib/company-os/human-admin';
import { applyCompanyOsRuntimeControl } from '@/lib/company-os/runtime-store';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const authorization = await requireHumanCompanyAdmin(request);
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  if (!hasTrustedHumanRequestOrigin(request)) return NextResponse.json({ error: 'Origen no permitido' }, { status: 403 });
  let input: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required');
    input = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const action = input.action;
  const idempotencyKey = input.idempotencyKey;
  if (!['PAUSE', 'RESUME', 'RETRY_CASE'].includes(String(action)) || typeof idempotencyKey !== 'string') {
    return NextResponse.json({ error: 'Acción o idempotencyKey inválidos' }, { status: 400 });
  }
  try {
    const result = await applyCompanyOsRuntimeControl({
      action: action as 'PAUSE' | 'RESUME' | 'RETRY_CASE',
      requestId: typeof input.requestId === 'string' ? input.requestId : undefined,
      idempotencyKey,
      actorRef: authorization.identity.actorRef,
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Control rechazado' }, { status: 409 });
  }
}
