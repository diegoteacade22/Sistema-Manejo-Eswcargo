import * as XLSX from '@e965/xlsx';

export type OfferedPriceItem = {
  lineId: string;
  description: string;
  offeredUnitCost: number;
  currency: 'USD';
  sku?: string;
  supplierSku?: string;
  quantity?: number;
  spec?: string;
  sheet?: string;
  sourceRow?: number;
};

const MAX_ITEMS = 500;
const MAX_ROWS_PER_SHEET = 2_000;

const headerAliases = {
  description: ['item name', 'item', 'description', 'descripcion', 'producto', 'product', 'model', 'modelo', 'name'],
  price: ['price', 'unit price', 'precio', 'precio unitario', 'cost', 'costo', 'sale', 'wholesale'],
  quantity: ['in stock', 'stock', 'qty', 'quantity', 'cantidad', 'available', 'disponible'],
  supplierSku: ['sku', 'item no', 'item number', 'no', 'part no', 'part number', 'mpn', 'codigo', 'code'],
  spec: ['spec', 'region', 'country', 'version', 'mercado', 'pais'],
} as const;

function normalizeText(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u200e\u200f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeHeader(value: unknown) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[._/-]+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = normalizeText(value);
  if (!text) return null;

  const stripped = text.replace(/(?:usd|us\$|\$)/gi, '').replace(/\s/g, '');
  let normalized = stripped;

  if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(stripped)) {
    normalized = stripped.replace(/,/g, '');
  } else if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(stripped)) {
    normalized = stripped.replace(/\./g, '').replace(',', '.');
  } else if (/^\d+,\d{1,2}$/.test(stripped)) {
    normalized = stripped.replace(',', '.');
  } else {
    normalized = stripped.replace(/,/g, '');
  }

  const parsed = Number(normalized.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function findColumn(header: unknown[], aliases: readonly string[]) {
  const normalizedAliases = aliases.map(normalizeHeader);
  for (let index = 0; index < header.length; index += 1) {
    const value = normalizeHeader(header[index]);
    if (!value) continue;
    if (normalizedAliases.some((alias) => value === alias || value.includes(alias))) return index;
  }
  return -1;
}

function findHeaderRow(rows: unknown[][]) {
  let best: { index: number; score: number } | null = null;
  const limit = Math.min(rows.length, 30);

  for (let index = 0; index < limit; index += 1) {
    const row = rows[index] || [];
    const description = findColumn(row, headerAliases.description);
    const price = findColumn(row, headerAliases.price);
    const quantity = findColumn(row, headerAliases.quantity);
    const supplierSku = findColumn(row, headerAliases.supplierSku);
    const score = (description >= 0 ? 4 : 0) + (price >= 0 ? 4 : 0) + (quantity >= 0 ? 1 : 0) + (supplierSku >= 0 ? 1 : 0);

    if (description >= 0 && price >= 0 && (!best || score > best.score)) {
      best = { index, score };
    }
  }

  return best?.index ?? -1;
}

function rowsToOffers(rows: unknown[][], sheet: string): OfferedPriceItem[] {
  const headerIndex = findHeaderRow(rows);
  if (headerIndex < 0) return [];

  const header = rows[headerIndex] || [];
  const descriptionIndex = findColumn(header, headerAliases.description);
  const priceIndex = findColumn(header, headerAliases.price);
  const quantityIndex = findColumn(header, headerAliases.quantity);
  const supplierSkuIndex = findColumn(header, headerAliases.supplierSku);
  const specIndex = findColumn(header, headerAliases.spec);
  const items: OfferedPriceItem[] = [];

  for (let rowIndex = headerIndex + 1; rowIndex < Math.min(rows.length, MAX_ROWS_PER_SHEET); rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const description = normalizeText(row[descriptionIndex]);
    const offeredUnitCost = asFiniteNumber(row[priceIndex]);
    if (!description || !offeredUnitCost || offeredUnitCost <= 0) continue;

    const quantity = quantityIndex >= 0 ? asFiniteNumber(row[quantityIndex]) : null;
    const supplierSku = supplierSkuIndex >= 0 ? normalizeText(row[supplierSkuIndex]) : '';
    const spec = specIndex >= 0 ? normalizeText(row[specIndex]) : '';

    items.push({
      lineId: `${sheet}:${rowIndex + 1}`,
      description,
      offeredUnitCost,
      currency: 'USD',
      supplierSku: supplierSku || undefined,
      quantity: quantity !== null && quantity >= 0 ? quantity : undefined,
      spec: spec || undefined,
      sheet,
      sourceRow: rowIndex + 1,
    });

    if (items.length >= MAX_ITEMS) break;
  }

  return items;
}

function priceFromLine(line: string) {
  const matches = [...line.matchAll(/(?:USD|US\$|\$)\s*([0-9][0-9.,]*)/gi)];
  const match = matches.at(-1);
  if (!match) return null;
  const value = asFiniteNumber(match[1]);
  if (!value || value <= 0) return null;
  return { value, index: match.index ?? 0 };
}

export function parseOfferText(text: string): OfferedPriceItem[] {
  const items: OfferedPriceItem[] = [];
  const lines = text.split(/\r?\n/).map(normalizeText).filter(Boolean);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const price = priceFromLine(line);
    if (!price) continue;

    const description = line
      .slice(0, price.index)
      .replace(/^[•*\-–—\s📱📲💻⌚📟📦]+/u, '')
      .replace(/[–—:-]\s*$/, '')
      .trim();
    if (!description || description.length < 3) continue;

    const quantityMatch = line.match(/(?:qty|quantity|cantidad|stock|in stock)\s*[:=-]?\s*(\d+)/i);
    items.push({
      lineId: `text:${index + 1}`,
      description,
      offeredUnitCost: price.value,
      currency: 'USD',
      quantity: quantityMatch ? Number(quantityMatch[1]) : undefined,
      sourceRow: index + 1,
    });

    if (items.length >= MAX_ITEMS) break;
  }

  return items;
}

export function parsePriceListBuffer(buffer: Buffer, filename: string): OfferedPriceItem[] {
  const extension = filename.toLowerCase().split('.').pop() || '';
  if (extension === 'txt') return parseOfferText(buffer.toString('utf8'));

  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: true,
    cellFormula: false,
    cellHTML: false,
    cellText: true,
  });

  const items: OfferedPriceItem[] = [];
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: false,
    });
    items.push(...rowsToOffers(rows, sheetName));
    if (items.length >= MAX_ITEMS) break;
  }

  return items.slice(0, MAX_ITEMS);
}

