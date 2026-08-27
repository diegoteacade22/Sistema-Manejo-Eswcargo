import { NextResponse } from 'next/server';
import { requireHumanCompanyAdmin } from '@/lib/company-os/human-admin';
import { getEngineeringControlCenter } from '@/lib/company-os/engineering-store';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const authorization = await requireHumanCompanyAdmin(request);
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  try {
    return NextResponse.json(await getEngineeringControlCenter(), { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Telemetría de ingeniería no disponible' }, { status: 503 });
  }
}
