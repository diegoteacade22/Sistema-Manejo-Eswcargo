import { NextResponse } from 'next/server';
import { hasTrustedHumanRequestOrigin, requireHumanCompanyAdmin } from '@/lib/company-os/human-admin';
import { appendCompanyOsContext } from '@/lib/company-os/v3-store';

export async function POST(request: Request, context: { params: Promise<{ requestId: string }> }) {
  const authorization = await requireHumanCompanyAdmin(request);
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  if (!hasTrustedHumanRequestOrigin(request)) return NextResponse.json({ error: 'Origen no permitido' }, { status: 403 });
  let content = '';
  try { content = String((await request.json())?.content ?? ''); } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }); }
  try {
    const { requestId } = await context.params;
    const message = await appendCompanyOsContext(requestId, content, authorization.identity);
    return NextResponse.json({ message, appendOnly: true }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo agregar contexto' }, { status: 409 });
  }
}

