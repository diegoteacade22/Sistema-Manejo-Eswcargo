import { NextResponse } from 'next/server';
import { CodexTaskStoreError, ingestCodexTaskChunk } from '@/lib/company-os/codex-task-store';
import { verifyCodexIntakeRequest } from '@/lib/company-os/codex-task-auth';
import { acceptCompanyOsRuntimeNonce, CompanyOsRuntimeRequestError } from '@/lib/company-os/runtime-store';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ error: 'Content-Type debe ser application/json' }, { status: 415 });
  }
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, 'utf8') > 1_048_576) return NextResponse.json({ error: 'Body demasiado grande' }, { status: 413 });
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
  try {
    await acceptCompanyOsRuntimeNonce(authorization.workerId, authorization.nonce, new URL(request.url).pathname);
    return NextResponse.json(await ingestCodexTaskChunk(input, authorization.workerId), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof CompanyOsRuntimeRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
    const status = error instanceof CodexTaskStoreError ? error.status : 500;
    const message = error instanceof CodexTaskStoreError ? error.message : 'No se pudo actualizar el inventario Codex';
    return NextResponse.json({ error: message }, { status });
  }
}
