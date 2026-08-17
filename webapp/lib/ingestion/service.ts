import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { IngestRequest } from './contracts';
import { matchCatalog } from './normalize';
import { extractSupplierList } from './openai';

function hashInput(text: string, supplier?: string) {
  return createHash('sha256')
    .update(`${supplier?.trim().toLowerCase() || ''}\n${text.trim()}`)
    .digest('hex');
}

const ingestionInclude = {
  items: {
    include: {
      normalizedProduct: { select: { id: true, sku: true, name: true, model: true } },
      offer: true,
    },
  },
} satisfies Prisma.IngestionRunInclude;

export class IngestionConflictError extends Error {}

export function validateTraceability(rawText: string, items: Array<{ lineNumber: number; rawLine: string }>) {
  if (!items.length) throw new Error('OpenAI no extrajo productos de la entrada.');
  const sourceLines = rawText.split(/\r?\n/);
  const seen = new Set<number>();
  for (const item of items) {
    if (seen.has(item.lineNumber)) throw new Error('OpenAI devolvió números de línea duplicados.');
    seen.add(item.lineNumber);
    if (sourceLines[item.lineNumber - 1]?.trim() !== item.rawLine.trim()) {
      throw new Error('OpenAI devolvió una línea que no coincide con la entrada original.');
    }
  }
}

export async function ingestSupplierText(input: IngestRequest) {
  const contentHash = hashInput(input.text, input.supplier);
  const byKey = input.idempotencyKey
    ? await prisma.ingestionRun.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: ingestionInclude,
    })
    : null;
  if (byKey && byKey.contentHash !== contentHash) {
    throw new IngestionConflictError('La clave de idempotencia ya fue usada con otro contenido.');
  }
  if (byKey && byKey.status !== 'FAILED') return { duplicate: true, ingestion: byKey };

  const recentCutoff = new Date(Date.now() - 15 * 60_000);
  const recent = !input.idempotencyKey
    ? await prisma.ingestionRun.findFirst({
      where: {
        contentHash,
        createdAt: { gte: recentCutoff },
        status: { in: ['PROCESSING', 'COMPLETED', 'NEEDS_REVIEW'] },
      },
      orderBy: { createdAt: 'desc' },
      include: ingestionInclude,
    })
    : null;
  if (recent) return { duplicate: true, ingestion: recent };

  const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();
  let run;
  if (byKey) {
    run = await prisma.ingestionRun.update({
      where: { id: byKey.id },
      data: { status: 'PROCESSING', errorMessage: null, receivedAt },
    });
  } else {
    try {
      run = await prisma.ingestionRun.create({
        data: {
          rawText: input.text,
          contentHash,
          idempotencyKey: input.idempotencyKey,
          receivedAt,
          supplierName: input.supplier,
        },
      });
    } catch (error) {
      if (
        input.idempotencyKey
        && error instanceof Prisma.PrismaClientKnownRequestError
        && error.code === 'P2002'
      ) {
        const concurrent = await prisma.ingestionRun.findUniqueOrThrow({
          where: { idempotencyKey: input.idempotencyKey },
          include: ingestionInclude,
        });
        if (concurrent.contentHash !== contentHash) {
          throw new IngestionConflictError('La clave de idempotencia ya fue usada con otro contenido.');
        }
        return { duplicate: true, ingestion: concurrent };
      }
      throw error;
    }
  }

  try {
    const { extraction, model } = await extractSupplierList(input.text);
    validateTraceability(input.text, extraction.items);
    const supplierName = input.supplier || extraction.supplier || undefined;
    const suppliers = supplierName
      ? await prisma.supplier.findMany({
        where: { name: { equals: supplierName, mode: 'insensitive' } },
        take: 2,
      })
      : [];
    const supplier = suppliers.length === 1 ? suppliers[0] : null;
    const catalog = await prisma.product.findMany({
      where: { active: true },
      select: { id: true, sku: true, name: true, model: true, brand: true, color_grade: true },
    });
    const normalized = extraction.items.map((item) => ({ item, match: matchCatalog(item, catalog) }));

    const result = await prisma.$transaction(async (tx) => {
      const requiresReview = normalized.some(({ item, match }) => (
        !supplier || !match.product || item.costUsd === null
      ));
      await tx.ingestionRun.update({
        where: { id: run.id },
        data: {
          status: requiresReview ? 'NEEDS_REVIEW' : 'COMPLETED',
          supplierId: supplier?.id,
          supplierName,
          model,
        },
      });
      for (const { item, match } of normalized) {
        const reasons = [
          !supplier && 'Proveedor no reconocido.',
          match.reason,
          item.costUsd === null && 'Costo USD ausente.',
        ].filter(Boolean);
        const saved = await tx.ingestionItem.create({
          data: {
            ingestionRunId: run.id,
            lineNumber: item.lineNumber,
            rawLine: item.rawLine,
            productName: item.product,
            exactModel: item.exactModel,
            capacity: item.capacity,
            color: item.color,
            condition: item.condition,
            region: item.region,
            costUsd: item.costUsd,
            availability: item.availability,
            quantity: item.quantity,
            observations: item.observations,
            normalizedProductId: match.product?.id,
            matchConfidence: match.confidence,
            reviewRequired: reasons.length > 0,
            reviewReason: reasons.join(' '),
            extractedData: item,
          },
        });
        if (supplier && match.product && item.costUsd !== null) {
          await tx.supplierOffer.create({
            data: {
              ingestionItemId: saved.id,
              supplierId: supplier.id,
              productId: match.product.id,
              costUsd: item.costUsd,
              quantity: item.quantity,
              availability: item.availability,
              observedAt: receivedAt,
            },
          });
        }
      }
      return tx.ingestionRun.findUniqueOrThrow({
        where: { id: run.id },
        include: ingestionInclude,
      });
    }, { maxWait: 5_000, timeout: 30_000 });
    return { duplicate: false, ingestion: result };
  } catch (error) {
    const message = error instanceof Error
      ? error.message.slice(0, 2_000)
      : 'Error desconocido de ingesta.';
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: { status: 'FAILED', errorMessage: message },
    });
    throw error;
  }
}
