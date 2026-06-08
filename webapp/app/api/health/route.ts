import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'eswcargo-webapp',
    timestamp: new Date().toISOString(),
  });
}
