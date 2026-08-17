import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { ContractValidationError, ingestRequestSchema } from '@/lib/ingestion/contracts';
import { IngestionConflictError, ingestSupplierText } from '@/lib/ingestion/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function suppliedKey(request: Request) {
  const direct = request.headers.get('x-agent-key')?.trim();
  if (direct) return direct;
  const authorization = request.headers.get('authorization')?.trim() || '';
  return authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : '';
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

async function authorized(request: Request) {
  const expected = process.env.AGENT_API_KEY?.trim();
  const supplied = suppliedKey(request);
  if (expected && supplied && safeEqual(supplied, expected)) return true;
  const session = await auth();
  return Boolean(session?.user && (session.user as { role?: string }).role === 'ADMIN');
}

export async function POST(request: Request) {
  if (!(await authorized(request))) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request inválido.' }, { status: 400 });
  }

  try {
    const input = ingestRequestSchema.parse(payload);
    const result = await ingestSupplierText(input);
    const humanReview = result.ingestion.items
      .filter((item) => item.reviewRequired)
      .map((item) => ({
        id: item.id,
        lineNumber: item.lineNumber,
        rawLine: item.rawLine,
        reason: item.reviewReason,
        matchConfidence: item.matchConfidence,
      }));
    const items = result.ingestion.items.map((item) => ({
      id: item.id,
      lineNumber: item.lineNumber,
      rawLine: item.rawLine,
      productName: item.productName,
      exactModel: item.exactModel,
      capacity: item.capacity,
      color: item.color,
      condition: item.condition,
      region: item.region,
      costUsd: item.costUsd,
      availability: item.availability,
      quantity: item.quantity,
      observations: item.observations,
      normalizedProduct: item.normalizedProduct,
      matchConfidence: item.matchConfidence,
      reviewRequired: item.reviewRequired,
      reviewReason: item.reviewReason,
      offer: item.offer,
    }));
    return NextResponse.json({
      ingestionId: result.ingestion.id,
      status: result.ingestion.status,
      duplicate: result.duplicate,
      supplier: {
        id: result.ingestion.supplierId,
        name: result.ingestion.supplierName,
      },
      items,
      humanReview,
    }, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    if (error instanceof ContractValidationError) {
      return NextResponse.json({ error: 'Request inválido.' }, { status: 400 });
    }
    if (error instanceof IngestionConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error('[ingestion] POST /api/ingest failed', error);
    return NextResponse.json({ error: 'No se pudo procesar la ingesta.' }, { status: 502 });
  }
}
