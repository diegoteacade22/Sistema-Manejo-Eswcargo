import { NextResponse } from 'next/server';
import { hasTrustedHumanRequestOrigin, requireHumanCompanyAdmin } from '@/lib/company-os/human-admin';
import { CodexTaskStoreError, getHumanWorkCenter, markCodexTaskDone } from '@/lib/company-os/codex-task-store';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const authorization = await requireHumanCompanyAdmin(request);
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  try {
    return NextResponse.json(await getHumanWorkCenter(), { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'El tablero humano no está disponible todavía' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!hasTrustedHumanRequestOrigin(request)) return NextResponse.json({ error: 'Origen no permitido' }, { status: 403 });
  const authorization = await requireHumanCompanyAdmin(request);
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  try {
    const body = await request.json() as { action?: unknown; threadId?: unknown };
    if (body.action !== 'MARK_DONE') return NextResponse.json({ error: 'Acción no permitida' }, { status: 400 });
    return NextResponse.json(await markCodexTaskDone(body.threadId, authorization.identity.actorRef));
  } catch (error) {
    if (error instanceof CodexTaskStoreError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: 'No se pudo validar la tarea' }, { status: 500 });
  }
}
