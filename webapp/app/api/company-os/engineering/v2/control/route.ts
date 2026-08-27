import { NextResponse } from 'next/server';
import { applyEngineeringControl, EngineeringStoreError } from '@/lib/company-os/engineering-store';
import { hasTrustedHumanRequestOrigin, requireHumanCompanyAdmin } from '@/lib/company-os/human-admin';

export const dynamic = 'force-dynamic';

const ACTIONS = [
  'PAUSE_INTAKE', 'RESUME_INTAKE', 'PAUSE_EXECUTION', 'RESUME_EXECUTION', 'EMERGENCY_STOP', 'CLEAR_EMERGENCY',
  'QUARANTINE_REPOSITORY', 'UNQUARANTINE_REPOSITORY', 'DISABLE_ACTOR', 'ENABLE_ACTOR',
] as const;

export async function POST(request: Request) {
  const authorization = await requireHumanCompanyAdmin(request);
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  if (!hasTrustedHumanRequestOrigin(request)) return NextResponse.json({ error: 'Origen no permitido' }, { status: 403 });
  let input: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object');
    input = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const action = typeof input.action === 'string' && ACTIONS.includes(input.action as typeof ACTIONS[number])
    ? input.action as typeof ACTIONS[number] : null;
  if (!action || typeof input.idempotencyKey !== 'string') {
    return NextResponse.json({ error: 'Control incompleto' }, { status: 400 });
  }
  try {
    return NextResponse.json(await applyEngineeringControl({
      action,
      target: typeof input.target === 'string' ? input.target : undefined,
      idempotencyKey: input.idempotencyKey,
      actorRef: authorization.identity.actorRef,
    }));
  } catch (error) {
    const status = error instanceof EngineeringStoreError ? error.status : 409;
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Control rechazado' }, { status });
  }
}
