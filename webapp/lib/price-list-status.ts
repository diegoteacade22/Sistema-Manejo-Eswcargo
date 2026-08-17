import { prisma } from '@/lib/prisma';

const BUSINESS_TIME_ZONE = 'America/New_York';

type PriceListLoadRow = {
  id: string;
  supplierName: string | null;
  sourceName: string | null;
  status: string;
  rowsAnalyzed: number;
  uniqueProductsAnalyzed: number;
  probableCount: number;
  possibleCount: number;
  manualReviewCount: number;
  receivedAt: Date;
};

export function businessDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function isPriceListStatusIntent(prompt: string) {
  const normalized = prompt.toLocaleLowerCase('es');
  return /(lista|listas|precio|precios|cotiz|proveedor|proveedores)/.test(normalized)
    && /(carg|sub|recib|hoy|ayer|últim|ultimo|cuánt|cuant|cuantas|cuántas|estado)/.test(normalized);
}

export async function getPriceListStatus(dateKey = businessDateKey()) {
  const rows = await prisma.$queryRaw<PriceListLoadRow[]>`
    SELECT
      "id",
      "supplierName",
      "sourceName",
      "status",
      "rowsAnalyzed",
      "uniqueProductsAnalyzed",
      "probableCount",
      "possibleCount",
      "manualReviewCount",
      "receivedAt"
    FROM "SupplierPriceListLoad"
    WHERE ("receivedAt" AT TIME ZONE ${BUSINESS_TIME_ZONE})::date = ${dateKey}::date
    ORDER BY "receivedAt" DESC
    LIMIT 50
  `;

  const loaded = rows.filter((row) => row.status === 'LOADED');
  const failed = rows.filter((row) => row.status === 'FAILED');
  const providers = [...new Set(
    loaded.map((row) => row.supplierName?.trim()).filter((value): value is string => Boolean(value)),
  )].sort((left, right) => left.localeCompare(right, 'es'));

  return {
    date: dateKey,
    loadedCount: loaded.length,
    failedCount: failed.length,
    providers,
    loads: rows.map((row) => ({
      id: row.id,
      supplierName: row.supplierName,
      sourceName: row.sourceName,
      status: row.status,
      rowsAnalyzed: row.rowsAnalyzed,
      uniqueProductsAnalyzed: row.uniqueProductsAnalyzed,
      probableCount: row.probableCount,
      possibleCount: row.possibleCount,
      manualReviewCount: row.manualReviewCount,
      receivedAt: row.receivedAt.toISOString(),
    })),
  };
}

export function formatPriceListStatus(status: Awaited<ReturnType<typeof getPriceListStatus>>) {
  if (status.loadedCount === 0 && status.failedCount === 0) {
    return `No tengo registrada ninguna carga de lista de proveedores para ${status.date} en ImportSys/Agent OS. Esta consulta no usa Gmail.`;
  }

  const providerText = status.providers.length > 0
    ? status.providers.join(', ')
    : 'proveedor no identificado';
  const loadedText = status.loadedCount === 1
    ? 'Sí, registraste 1 lista'
    : `Sí, registraste ${status.loadedCount} listas`;
  const failedText = status.failedCount > 0
    ? ` También hay ${status.failedCount} carga(s) con error, que no cuento como lista cargada.`
    : '';
  return `${loadedText} para ${status.date}. Proveedores: ${providerText}.${failedText}`;
}
