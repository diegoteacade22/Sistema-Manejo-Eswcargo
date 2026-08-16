import { NextResponse } from 'next/server';
import { hasTrustedHumanRequestOrigin, requireHumanCompanyAdmin } from '@/lib/company-os/human-admin';
import { decideCompanyOsMission } from '@/lib/company-os/v3-store';

export async function POST(request: Request) {
  const authorization = await requireHumanCompanyAdmin(request);
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  if (!hasTrustedHumanRequestOrigin(request)) return NextResponse.json({ error: 'Origen no permitido' }, { status: 403 });
  let input: Parameters<typeof decideCompanyOsMission>[0];
  try { input = await request.json(); } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }); }
  if (!input?.requestId || !input?.missionId || !input?.idempotencyKey || !['APPROVE','REJECT','REQUEST_REVIEW','BLOCK','EDIT','POSTPONE','MARK_INCORRECT'].includes(input.decision)) {
    return NextResponse.json({ error: 'Decisión inválida' }, { status: 400 });
  }
  try {
    const result = await decideCompanyOsMission(input, authorization.identity);
    return NextResponse.json({ ...result, executionAuthorized: false, businessWrites: 0 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo registrar la decisión' }, { status: 409 });
  }
}
