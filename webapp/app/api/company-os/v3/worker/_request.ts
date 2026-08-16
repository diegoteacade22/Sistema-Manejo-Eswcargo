import { NextResponse } from 'next/server';
import { verifyCompanyOsWorkerRequest } from '@/lib/company-os/v3-auth';

export async function verifiedWorkerJson(request: Request) {
  const rawBody = await request.text();
  if (!verifyCompanyOsWorkerRequest(request, rawBody)) {
    return { error: NextResponse.json({ error: 'Firma HMAC inválida' }, { status: 401 }) } as const;
  }
  try {
    return { input: JSON.parse(rawBody || '{}') as Record<string, unknown> } as const;
  } catch {
    return { error: NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) } as const;
  }
}

