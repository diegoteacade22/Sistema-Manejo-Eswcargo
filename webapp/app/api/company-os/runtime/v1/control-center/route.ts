import { NextResponse } from 'next/server';
import { requireHumanCompanyAdmin } from '@/lib/company-os/human-admin';
import { getCompanyOsRuntimeControlCenter } from '@/lib/company-os/runtime-store';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const authorization = await requireHumanCompanyAdmin(request);
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  try {
    return NextResponse.json(await getCompanyOsRuntimeControlCenter(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[Company OS Runtime] control center failed', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Telemetría de runtime no disponible' }, { status: 503 });
  }
}
