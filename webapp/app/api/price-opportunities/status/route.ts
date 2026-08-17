import { verifyAgentRequest } from '@/lib/agent-auth';
import { auth } from '@/lib/auth';
import { getPriceListStatus, businessDateKey } from '@/lib/price-list-status';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function authorize(request: Request) {
  if (verifyAgentRequest(request, '')) return true;
  const session = await auth();
  return session?.user && (session.user as { role?: string }).role === 'ADMIN';
}

export async function GET(request: Request) {
  if (!(await authorize(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const date = new URL(request.url).searchParams.get('date') || businessDateKey();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: 'date inválida' }, { status: 400 });

  try {
    return NextResponse.json(await getPriceListStatus(date));
  } catch (error) {
    console.error('[Price List Status] Read failed:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'No se pudo consultar el registro de listas.' }, { status: 503 });
  }
}
