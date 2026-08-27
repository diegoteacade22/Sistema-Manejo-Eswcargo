import { NextResponse } from 'next/server';
import { enqueueEngineeringMission, EngineeringStoreError } from '@/lib/company-os/engineering-store';
import { hasTrustedHumanRequestOrigin, requireHumanCompanyAdmin } from '@/lib/company-os/human-admin';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const authorization = await requireHumanCompanyAdmin(request);
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  if (!hasTrustedHumanRequestOrigin(request)) return NextResponse.json({ error: 'Origen no permitido' }, { status: 403 });
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  try {
    return NextResponse.json(await enqueueEngineeringMission(input, authorization.identity.actorRef), { status: 202 });
  } catch (error) {
    const status = error instanceof EngineeringStoreError ? error.status : 409;
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Misión rechazada' }, { status });
  }
}
