import { NextResponse } from 'next/server';
import { hasTrustedHumanRequestOrigin, requireHumanCompanyAdmin } from '@/lib/company-os/human-admin';
import { cancelCompanyOsCase } from '@/lib/company-os/v3-store';

export async function POST(request: Request, context: { params: Promise<{ requestId: string }> }) {
  const authorization = await requireHumanCompanyAdmin(request);
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  if (!hasTrustedHumanRequestOrigin(request)) return NextResponse.json({ error: 'Origen no permitido' }, { status: 403 });
  let reason = '';
  try { reason = String((await request.json())?.reason ?? 'Cancelado por un administrador'); } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }); }
  try {
    const { requestId } = await context.params;
    return NextResponse.json(await cancelCompanyOsCase(requestId, reason, authorization.identity));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo cancelar' }, { status: 409 });
  }
}

