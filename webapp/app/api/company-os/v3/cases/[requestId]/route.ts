import { NextResponse } from 'next/server';
import { requireHumanCompanyAdmin } from '@/lib/company-os/human-admin';
import { getCompanyOsCase } from '@/lib/company-os/v3-store';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ requestId: string }> }) {
  const authorization = await requireHumanCompanyAdmin(request);
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const { requestId } = await context.params;
  const companyCase = await getCompanyOsCase(requestId);
  if (!companyCase) return NextResponse.json({ error: 'Caso no encontrado' }, { status: 404 });
  return NextResponse.json({ ...companyCase, businessWrites: 0 }, { headers: { 'Cache-Control': 'no-store' } });
}

