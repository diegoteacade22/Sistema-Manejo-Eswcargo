import crypto from 'node:crypto';
import { auth } from '@/lib/auth';
import { analyzePriceOpportunities } from '@/lib/price-opportunities';
import {
  parseOfferText,
  parsePriceListBuffer,
  type OfferedPriceItem,
} from '@/lib/price-list-parser';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = new Set(['xls', 'xlsx', 'xlsm', 'csv', 'txt']);

function suppliedKey(request: Request) {
  const direct = request.headers.get('x-agent-key')?.trim();
  if (direct) return direct;
  const authorization = request.headers.get('authorization')?.trim();
  return authorization?.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : '';
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

async function authorize(request: Request) {
  const expectedKey = (process.env.AGENT_API_KEY || '').trim();
  const providedKey = suppliedKey(request);
  if (expectedKey && providedKey && safeEqual(providedKey, expectedKey)) return { ok: true as const };

  const session = await auth();
  if (!session?.user) return { ok: false as const, status: 401, error: 'Unauthorized' };
  if ((session.user as { role?: string }).role !== 'ADMIN') {
    return { ok: false as const, status: 403, error: 'Forbidden' };
  }
  return { ok: true as const };
}

function validatedJsonItems(value: unknown): OfferedPriceItem[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 500).flatMap((raw, index) => {
    if (!raw || typeof raw !== 'object') return [];
    const item = raw as Record<string, unknown>;
    const description = String(item.description || '').trim();
    const offeredUnitCost = Number(item.offeredUnitCost);
    if (!description || !Number.isFinite(offeredUnitCost) || offeredUnitCost <= 0) return [];

    return [{
      lineId: String(item.lineId || `json:${index + 1}`),
      description,
      offeredUnitCost,
      currency: 'USD' as const,
      sku: item.sku ? String(item.sku).trim() : undefined,
      supplierSku: item.supplierSku ? String(item.supplierSku).trim() : undefined,
      spec: item.spec ? String(item.spec).trim() : undefined,
      quantity: Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : undefined,
    }];
  });
}

export async function POST(request: Request) {
  const authorization = await authorize(request);
  if (!authorization.ok) {
    return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  }

  try {
    const contentType = request.headers.get('content-type') || '';
    let items: OfferedPriceItem[] = [];
    let sourceName = 'entrada';
    let historyLimit = 5;

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      const fileValue = form.get('file');
      const text = String(form.get('text') || '').trim();
      historyLimit = Number(form.get('historyLimit') || 5);

      if (fileValue instanceof File && fileValue.size > 0) {
        if (fileValue.size > MAX_FILE_BYTES) {
          return NextResponse.json({ error: 'El archivo supera el límite de 10 MB.' }, { status: 413 });
        }

        const extension = fileValue.name.toLowerCase().split('.').pop() || '';
        if (!ACCEPTED_EXTENSIONS.has(extension)) {
          return NextResponse.json({ error: 'Formato no soportado. Usa XLS, XLSX, XLSM, CSV o TXT.' }, { status: 415 });
        }

        sourceName = fileValue.name;
        items = parsePriceListBuffer(Buffer.from(await fileValue.arrayBuffer()), fileValue.name);
      } else if (text) {
        sourceName = 'texto de WhatsApp';
        items = parseOfferText(text);
      }
    } else {
      const body = await request.json();
      historyLimit = Number(body?.historyLimit || 5);
      sourceName = typeof body?.sourceName === 'string' ? body.sourceName : 'integración';
      items = validatedJsonItems(body?.items);
      if (!items.length && typeof body?.text === 'string') items = parseOfferText(body.text);
    }

    if (!items.length) {
      return NextResponse.json({
        error: 'No se detectaron productos con descripción y precio USD.',
      }, { status: 400 });
    }

    const analysis = await analyzePriceOpportunities(items, historyLimit);
    return NextResponse.json({ sourceName, ...analysis });
  } catch (error) {
    console.error('[Price Opportunities] Analysis failed:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'No se pudo analizar la lista de precios.' }, { status: 500 });
  }
}

