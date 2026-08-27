import { NextResponse } from 'next/server';
import { reserveEngineeringEffect } from '@/lib/company-os/engineering-store';
import { engineeringError, verifiedRuntimeJson } from '../../_request';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const verified = await verifiedRuntimeJson(request);
  if ('error' in verified) return verified.error;
  try {
    return NextResponse.json(await reserveEngineeringEffect(verified.input));
  } catch (error) {
    return engineeringError(error);
  }
}
