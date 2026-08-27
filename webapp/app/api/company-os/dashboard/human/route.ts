import { NextResponse } from 'next/server';
import { requireHumanCompanyAdmin } from '@/lib/company-os/human-admin';
import { getHumanWorkCenter } from '@/lib/company-os/codex-task-store';

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
