import { NextResponse } from 'next/server';
import { hasTrustedHumanRequestOrigin, requireHumanCompanyAdmin } from '@/lib/company-os/human-admin';
import { CodexTaskStoreError, getHumanWorkCenter, manageCodexTask, markCodexTaskDone, submitCodexTaskReply } from '@/lib/company-os/codex-task-store';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const authorization = await requireHumanCompanyAdmin(request);
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  try {
    return NextResponse.json(await getHumanWorkCenter(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('company_os_human_dashboard_unavailable', {
      name: error instanceof Error ? error.name : 'UnknownError',
      code: typeof error === 'object' && error && 'code' in error ? String(error.code) : null,
    });
    return NextResponse.json({ error: 'El tablero humano no está disponible todavía' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!hasTrustedHumanRequestOrigin(request)) return NextResponse.json({ error: 'Origen no permitido' }, { status: 403 });
  const authorization = await requireHumanCompanyAdmin(request);
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  try {
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      return NextResponse.json({ error: 'Se requiere contenido JSON' }, { status: 415 });
    }
    const declaredLength = Number(request.headers.get('content-length') ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > 65_536) return NextResponse.json({ error: 'Solicitud demasiado grande' }, { status: 413 });
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 65_536) return NextResponse.json({ error: 'Solicitud demasiado grande' }, { status: 413 });
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    if (body.action === 'MARK_DONE') {
      return NextResponse.json(await markCodexTaskDone(body.threadId, authorization.identity.actorRef));
    }
    if (body.action === 'SUBMIT_REPLY') {
      return NextResponse.json(await submitCodexTaskReply(body, authorization.identity.actorRef));
    }
    return NextResponse.json(await manageCodexTask(body, authorization.identity.actorRef));
  } catch (error) {
    if (error instanceof CodexTaskStoreError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
    return NextResponse.json({ error: 'No se pudo validar la tarea' }, { status: 500 });
  }
}
