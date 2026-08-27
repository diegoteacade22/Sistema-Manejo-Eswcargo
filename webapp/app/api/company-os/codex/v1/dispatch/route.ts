import { NextResponse } from 'next/server';
import {
  claimApprovedCodexTask,
  CodexTaskStoreError,
  reportCodexTaskDispatch,
} from '@/lib/company-os/codex-task-store';
import { verifyCodexIntakeRequest } from '@/lib/company-os/codex-task-auth';
import { acceptCompanyOsRuntimeNonce, CompanyOsRuntimeRequestError } from '@/lib/company-os/runtime-store';

export const dynamic = 'force-dynamic';
const DISPATCH_SOURCE_HOST = 'DiegoServer.local';
const DISPATCH_INSTANCE_ID = `${DISPATCH_SOURCE_HOST}:codex-auto-resume-v1`;

export async function POST(request: Request) {
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ error: 'Content-Type debe ser application/json' }, { status: 415 });
  }
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, 'utf8') > 65_536) return NextResponse.json({ error: 'Body demasiado grande' }, { status: 413 });
  const authorization = verifyCodexIntakeRequest(request, rawBody);
  if (!authorization) return NextResponse.json({ error: 'Firma Codex HMAC v2 inválida' }, { status: 401 });
  let input: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required');
    input = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  if (input.workerId !== authorization.workerId || typeof input.instanceId !== 'string' || !input.instanceId.trim()) {
    return NextResponse.json({ error: 'Identidad Codex inválida' }, { status: 401 });
  }
  if (input.sourceHost !== DISPATCH_SOURCE_HOST || input.instanceId !== DISPATCH_INSTANCE_ID) {
    return NextResponse.json({ error: 'Host o instancia de despacho no autorizados' }, { status: 403 });
  }
  try {
    await acceptCompanyOsRuntimeNonce(authorization.workerId, authorization.nonce, new URL(request.url).pathname);
    if (input.action === 'CLAIM') {
      return NextResponse.json(await claimApprovedCodexTask(input, authorization.workerId), {
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    if (input.action === 'REPORT') {
      return NextResponse.json(await reportCodexTaskDispatch(input, authorization.workerId), {
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    return NextResponse.json({ error: 'Acción de despacho inválida' }, { status: 400 });
  } catch (error) {
    if (error instanceof CompanyOsRuntimeRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
    const status = error instanceof CodexTaskStoreError ? error.status : 500;
    const message = error instanceof CodexTaskStoreError ? error.message : 'No se pudo despachar la tarea Codex';
    return NextResponse.json({ error: message }, { status });
  }
}
