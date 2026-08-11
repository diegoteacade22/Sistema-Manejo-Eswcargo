import { createHash } from 'node:crypto';
import { GoogleAuth } from 'google-auth-library';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { calculateActiveOrderTotal } from '@/lib/order-totals';
import { itemSyncSignature, sameItemSet } from '@/lib/sync-item-comparison';
import {
  type CanonicalSourceRules,
  normalizeShipmentSourceRows,
  normalizeSourceRows,
} from '@/lib/sync-source-normalization';
import { resolveShipmentStatus, sourceShipmentStatus } from '@/lib/shipment-sync-status';
import canonicalSources from '@/config/canonical-source-overrides.json';

const DEFAULT_SPREADSHEET_ID = '1GhLokb_V5Yok2ubxBg8Tr0jxE3nFkwCD2sMvWDHZ20o';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const SHEET_TIMEOUT_MS = 12_000;
const TRANSACTION_TIMEOUT_MS = 25_000;
const OVERALL_TIMEOUT_MS = 42_000;
const DIRECT_SCOPE = 'DIRECT_OPERATIONAL';

type SheetValue = string | number | boolean | null | undefined;
type SheetMatrix = SheetValue[][];

type ValueRange = { range?: string; values?: SheetMatrix };
type BatchGetResponse = { valueRanges?: ValueRange[] };

export type DirectShipmentSource = {
  shipmentNumber: number;
  oldClientId: number | null;
  clientName: string | null;
  forwarder: string | null;
  dateShipped: string | null;
  dateArrived: string | null;
  weightForwarder: number;
  weightClient: number;
  typeLoad: string | null;
  itemCount: number | null;
  costTotal: number;
  priceTotal: number;
  profit: number;
  status: string | null;
  notes: string | null;
};

export type DirectOrderItemSource = {
  sku: string | null;
  productName: string | null;
  quantity: number;
  unitPrice: number;
  unitCost: number;
  profit: number;
  shipmentNumber: number | null;
  status: string | null;
};

export type DirectOrderSource = {
  orderNumber: number;
  oldClientId: number | null;
  clientName: string | null;
  date: string | null;
  paymentMethod: string | null;
  status: string | null;
  items: DirectOrderItemSource[];
};

export type DirectOperationalSource = {
  shipments: DirectShipmentSource[];
  orders: DirectOrderSource[];
};

export type DirectSyncSummary = {
  sourceHash: string;
  changed: number;
  source: { shipments: number; orders: number; items: number };
  created: { shipments: number; orders: number };
  updated: { shipments: number; orders: number };
  replaced: { orderItems: number };
  unchanged: { shipments: number; orders: number };
  rejected: { shipments: number; orders: number };
  idempotent: boolean;
};

export type DirectSyncResult = {
  runId: number;
  durationMs: number;
  summary: DirectSyncSummary;
  plannedChanges?: Array<{
    entity: string;
    entityKey: string;
    action: string;
    reason: string;
    fields: string[];
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  }>;
};

type Change = {
  entity: string;
  entityKey: string;
  action: 'CREATED' | 'UPDATED' | 'REPLACED' | 'REJECTED';
  reason: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
};

function normalizedHeader(value: SheetValue) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function cleanText(value: SheetValue) {
  const text = String(value ?? '').trim();
  if (!text || ['NAN', 'NONE', 'NULL'].includes(text.toUpperCase())) return null;
  return text.endsWith('.0') && /^-?\d+\.0$/.test(text) ? text.slice(0, -2) : text;
}

function numeric(value: SheetValue) {
  const parsed = Number(String(value ?? '').replaceAll('$', '').replaceAll(',', '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function integer(value: SheetValue) {
  const parsed = numeric(value);
  return Number.isFinite(parsed) && parsed !== 0 ? Math.trunc(parsed) : null;
}

function dateKey(value: SheetValue) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(Math.round((value - 25569) * 86_400_000)).toISOString().slice(0, 10);
  }
  const text = cleanText(value);
  if (!text) return null;
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) return `${slash[3]}-${slash[1].padStart(2, '0')}-${slash[2].padStart(2, '0')}`;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function normalizedOrderStatus(value: SheetValue) {
  const text = normalizedHeader(value);
  if (!text) return null;
  if (text.includes('CANCELADO')) return 'CANCELADO';
  if (text.includes('ENTREGADO') || text.includes('FINALIZADO')) return 'ENTREGADO';
  if (text.includes('BSAS') || text.includes('RECIBIDO')) return 'EN BSAS';
  if (text.includes('TRANSITO')) return 'EN TRANSITO';
  if (text.includes('LLEGANDO')) return 'LLEGANDO';
  if (text.includes('SALIENDO')) return 'SALIENDO';
  if (text.includes('MIAMI')) return 'MIAMI';
  if (text.includes('ENCARGADO')) return 'ENCARGADO';
  if (text.includes('COMPRAR')) return 'COMPRAR';
  return cleanText(value)?.toUpperCase() ?? null;
}

type Table = { headers: string[]; rows: SheetMatrix };

function tableFromMatrix(matrix: SheetMatrix, requiredHeaderAliases: string[][]): Table {
  const headerIndex = matrix.findIndex((row) => requiredHeaderAliases.every((aliases) =>
    aliases.some((alias) => row.map(normalizedHeader).includes(normalizedHeader(alias))),
  ));
  if (headerIndex < 0) {
    throw new Error(`No se encontro una cabecera valida (${requiredHeaderAliases.flat().join(', ')}).`);
  }
  return {
    headers: matrix[headerIndex].map(normalizedHeader),
    rows: matrix.slice(headerIndex + 1),
  };
}

function assertRequiredColumns(table: Table, sheetName: string, required: string[][]) {
  const missing = required.filter((aliases) => !aliases.some((alias) => table.headers.includes(normalizedHeader(alias))));
  if (missing.length) {
    throw new Error(`${sheetName} no contiene columnas requeridas: ${missing.map((aliases) => aliases[0]).join(', ')}.`);
  }
}

function cell(table: Table, row: SheetValue[], aliases: string[], occurrence = 0) {
  for (const alias of aliases) {
    const wanted = normalizedHeader(alias);
    const indexes = table.headers
      .map((header, index) => header === wanted ? index : -1)
      .filter((index) => index >= 0);
    if (indexes.length > occurrence) return row[indexes[occurrence]];
  }
  return undefined;
}

export function parseOperationalSheets(input: {
  cabeEnvios: SheetMatrix;
  cabeVentas: SheetMatrix;
  detaVentas: SheetMatrix;
}): DirectOperationalSource {
  const shipmentTable = tableFromMatrix(input.cabeEnvios, [['NRO ENVIO', 'NUMERO']]);
  const orderTable = tableFromMatrix(input.cabeVentas, [['INVOICE', 'INV', 'NRO_PEDIDO', 'PEDIDO']]);
  const itemTable = tableFromMatrix(input.detaVentas, [['INV-REM', 'NRO_PEDIDO'], ['SKU']]);
  assertRequiredColumns(shipmentTable, 'CABE_ENVIOS', [
    ['NRO ENVIO', 'NUMERO'], ['FORWARDER'], ['FECHA SAL', 'FECHA SALIDA'],
    ['FECHA LLEG', 'FECHA LLEGADA'], ['LLEGO?'], ['OBSERVACION', 'OBSERVACIONES'],
  ]);
  assertRequiredColumns(orderTable, 'CABE_VENTAS', [
    ['INVOICE', 'INV', 'NRO_PEDIDO', 'PEDIDO'], ['CLIENTE'], ['NRO CLI', 'COD CLI'],
    ['FECHA'], ['METODO', 'METODO PAGO'],
  ]);
  assertRequiredColumns(itemTable, 'DETA_VENTAS', [
    ['INV-REM', 'NRO_PEDIDO'], ['SKU'], ['CANT', 'CANTIDAD'], ['DETALLE', 'PRODUCTO'],
    ['ENVIO NRO', 'NRO ENVIO'], ['VTA UNI', 'PRECIO'], ['COSTO', 'COSTO X ART'],
    ['GANANCIA'], ['ESTADO'],
  ]);

  const shipments = shipmentTable.rows.flatMap((row): DirectShipmentSource[] => {
    const shipmentNumber = integer(cell(shipmentTable, row, ['NRO ENVIO', 'NUMERO']));
    if (!shipmentNumber) return [];
    const explicitStatus = sourceShipmentStatus(cell(shipmentTable, row, ['LLEGO?']));
    return [{
      shipmentNumber,
      oldClientId: integer(cell(shipmentTable, row, ['COD CLI', 'NRO CLI'])),
      clientName: cleanText(cell(shipmentTable, row, ['CLIENTE', 'NOMBRE'])),
      forwarder: cleanText(cell(shipmentTable, row, ['FORWARDER'])),
      dateShipped: dateKey(cell(shipmentTable, row, ['FECHA SAL', 'FECHA SALIDA'])),
      dateArrived: dateKey(cell(shipmentTable, row, ['FECHA LLEG', 'FECHA LLEGADA'])),
      weightForwarder: numeric(cell(shipmentTable, row, ['PESO FW', 'PESO'])),
      weightClient: numeric(cell(shipmentTable, row, ['PESO CLI', 'PESO'], 1)),
      typeLoad: cleanText(cell(shipmentTable, row, ['TIPO CARGA', 'TIPO', 'CARGA'])),
      itemCount: integer(cell(shipmentTable, row, ['CANT ART', 'CANTIDAD ART'])),
      costTotal: numeric(cell(shipmentTable, row, ['COSTO TOT', 'COSTO TOTAL'])),
      priceTotal: numeric(cell(shipmentTable, row, ['ENVIO COB', 'PRECIO TOTAL'])),
      profit: numeric(cell(shipmentTable, row, ['GANANCIA'])),
      status: explicitStatus,
      notes: cleanText(cell(shipmentTable, row, ['OBSERVACION', 'OBSERVACIONES'])),
    }];
  });

  const itemsByOrder = new Map<number, DirectOrderItemSource[]>();
  const clientByOrder = new Map<number, { oldClientId: number | null; clientName: string | null }>();
  for (const row of itemTable.rows) {
    const orderNumber = integer(cell(itemTable, row, ['INV-REM', 'NRO_PEDIDO']));
    if (!orderNumber) continue;
    const item: DirectOrderItemSource = {
      sku: cleanText(cell(itemTable, row, ['SKU'])),
      productName: cleanText(cell(itemTable, row, ['DETALLE', 'PRODUCTO'])),
      quantity: Math.trunc(numeric(cell(itemTable, row, ['CANT', 'CANTIDAD']))),
      unitPrice: numeric(cell(itemTable, row, ['VTA UNI', 'PRECIO'])),
      unitCost: numeric(cell(itemTable, row, ['COSTO', 'COSTO X ART'])),
      profit: numeric(cell(itemTable, row, ['GANANCIA'])),
      shipmentNumber: integer(cell(itemTable, row, ['ENVIO NRO', 'NRO ENVIO'])),
      status: normalizedOrderStatus(cell(itemTable, row, ['ESTADO'])),
    };
    const items = itemsByOrder.get(orderNumber) ?? [];
    items.push(item);
    itemsByOrder.set(orderNumber, items);
    if (!clientByOrder.has(orderNumber)) {
      clientByOrder.set(orderNumber, {
        oldClientId: integer(cell(itemTable, row, ['COD CLI', 'NRO CLI'])),
        clientName: cleanText(cell(itemTable, row, ['NOMBRE', 'CLIENTE'])),
      });
    }
  }

  const orders = orderTable.rows.flatMap((row): DirectOrderSource[] => {
    const orderNumber = integer(cell(orderTable, row, ['INVOICE', 'INV', 'NRO_PEDIDO', 'PEDIDO']));
    if (!orderNumber) return [];
    const detailClient = clientByOrder.get(orderNumber);
    const rawClient = cell(orderTable, row, ['CLIENTE']);
    const numericClient = integer(rawClient);
    return [{
      orderNumber,
      oldClientId: integer(cell(orderTable, row, ['NRO CLI', 'COD CLI'])) ?? numericClient ?? detailClient?.oldClientId ?? null,
      clientName: numericClient ? detailClient?.clientName ?? null : cleanText(rawClient) ?? detailClient?.clientName ?? null,
      date: dateKey(cell(orderTable, row, ['FECHA'])),
      paymentMethod: cleanText(cell(orderTable, row, ['METODO', 'METODO PAGO'])),
      status: normalizedOrderStatus(cell(orderTable, row, ['ESTADO'])),
      items: itemsByOrder.get(orderNumber) ?? [],
    }];
  });

  return { shipments, orders };
}

export function changedFieldPatch<T extends Record<string, unknown>>(
  existing: T,
  source: Partial<{ [K in keyof T]: T[K] | null | undefined }>,
  options: { preserveBlank?: (keyof T)[] } = {},
) {
  const preserveBlank = new Set<keyof T>(options.preserveBlank ?? []);
  const patch: Partial<T> = {};
  for (const [rawKey, value] of Object.entries(source) as [keyof T, T[keyof T]][]) {
    if (preserveBlank.has(rawKey) && (value === null || value === undefined || value === '')) continue;
    const current = existing[rawKey];
    const equal = current instanceof Date && value instanceof Date
      ? current.toISOString().slice(0, 10) === value.toISOString().slice(0, 10)
      : typeof current === 'number' || typeof value === 'number'
        ? Number(current ?? 0) === Number(value ?? 0)
        : (current ?? null) === (value ?? null);
    if (!equal) patch[rawKey] = value;
  }
  return patch;
}

export function sourceWouldEraseExistingItems(sourceItemCount: number, existingItemCount: number) {
  return sourceItemCount === 0 && existingItemCount > 0;
}

export function shipmentBelongsToWindow(
  shipment: { shipment_number?: unknown; date_shipped?: unknown; date_arrived?: unknown },
  cutoffKey: string,
  referencedShipmentNumbers: Set<number>,
) {
  const shipped = shipment.date_shipped ? String(shipment.date_shipped).slice(0, 10) : null;
  const arrived = shipment.date_arrived ? String(shipment.date_arrived).slice(0, 10) : null;
  return (shipped !== null && shipped >= cutoffKey)
    || (arrived !== null && arrived >= cutoffKey)
    || referencedShipmentNumbers.has(Number(shipment.shipment_number));
}

export function directShipmentStatus(options: {
  existingStatus?: string | null;
  sourceStatus?: string | null;
  dateShipped?: string | null;
  dateArrived?: string | null;
}) {
  const existing = sourceShipmentStatus(options.existingStatus);
  if (existing === 'ENTREGADO' || existing === 'CANCELADO') return existing;
  return sourceShipmentStatus(options.sourceStatus) ?? resolveShipmentStatus({
    existingStatus: options.existingStatus,
    dateShipped: options.dateShipped,
    dateArrived: options.dateArrived,
  });
}

function credentialsFromEnvironment() {
  const encoded = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64?.trim();
  const raw = encoded
    ? Buffer.from(encoded, 'base64').toString('utf8')
    : process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) throw new Error('Falta GOOGLE_SERVICE_ACCOUNT_JSON_BASE64.');
  const credentials = JSON.parse(raw) as { client_email?: string; private_key?: string };
  if (!credentials.client_email || !credentials.private_key) throw new Error('Credencial Google incompleta.');
  credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
  return credentials;
}

export function isRetryableSheetsError(error: unknown) {
  const candidate = error as { status?: number; response?: { status?: number }; name?: string; code?: string };
  const status = candidate.status ?? candidate.response?.status;
  return status === undefined
    || status === 408
    || status === 429
    || status >= 500
    || candidate.name === 'AbortError'
    || candidate.code === 'ETIMEDOUT';
}

async function fetchOperationalSource() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim() || DEFAULT_SPREADSHEET_ID;
  const auth = new GoogleAuth({
    credentials: credentialsFromEnvironment(),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const ranges = ['CABE_ENVIOS!A:X', 'CABE_VENTAS!A:Z', 'DETA_VENTAS!A:Y'];
  const query = new URLSearchParams({
    majorDimension: 'ROWS',
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'SERIAL_NUMBER',
  });
  for (const range of ranges) query.append('ranges', range);
  let response: Awaited<ReturnType<typeof auth.request<BatchGetResponse>>> | null = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      response = await auth.request<BatchGetResponse>({
        url: `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values:batchGet?${query}`,
        method: 'GET',
        timeout: SHEET_TIMEOUT_MS,
      });
      break;
    } catch (error) {
      if (attempt === 2 || !isRetryableSheetsError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }
  if (!response) throw new Error('Google Sheets no respondio despues de los reintentos.');
  const returned = response.data.valueRanges ?? [];
  if (returned.length !== ranges.length) throw new Error('Google Sheets no devolvio las tres hojas operativas.');
  return parseOperationalSheets({
    cabeEnvios: returned[0].values ?? [],
    cabeVentas: returned[1].values ?? [],
    detaVentas: returned[2].values ?? [],
  });
}

function sourceHash(source: DirectOperationalSource) {
  return createHash('sha256').update(JSON.stringify(source)).digest('hex');
}

function dateFromKey(value: string | null) {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

function nameKey(value: string | null | undefined) {
  return String(value ?? '').trim().toUpperCase();
}

function skuKey(value: string | null | undefined) {
  return String(value ?? '').trim().toUpperCase();
}

function assertDeadline(deadline: number) {
  if (Date.now() > deadline) throw new Error('La sincronizacion directa supero el tiempo operativo permitido.');
}

function jsonSnapshot(value: Record<string, unknown>): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function runDirectSheetSync(options: { dryRun?: boolean; days?: number } = {}): Promise<DirectSyncResult> {
  const startedAt = Date.now();
  const deadline = startedAt + OVERALL_TIMEOUT_MS;
  let parsedSource: DirectOperationalSource | null = null;
  try {
    parsedSource = await fetchOperationalSource();
    assertDeadline(deadline);
    const configuredShipmentRules = canonicalSources.shipments as CanonicalSourceRules;
    const shipmentRules = Object.fromEntries(Object.entries(configuredShipmentRules).map(([key, rule]) => [
      key,
      {
        ...rule,
        ...(rule.match ? {
          match: {
            ...rule.match,
            ...('date_shipped' in rule.match
              ? { date_shipped: String(rule.match.date_shipped).slice(0, 10) }
              : {}),
          },
        } : {}),
      },
    ])) as CanonicalSourceRules;
    const normalizedShipments = normalizeShipmentSourceRows(
      parsedSource.shipments.map((shipment) => ({
        ...shipment,
        shipment_number: shipment.shipmentNumber,
        old_client_id: shipment.oldClientId,
        client_name_match: shipment.clientName,
        forwarder: shipment.forwarder,
        date_shipped: shipment.dateShipped,
        date_arrived: shipment.dateArrived,
        weight_fw: shipment.weightForwarder,
        weight_cli: shipment.weightClient,
        type_load: shipment.typeLoad,
        item_count: shipment.itemCount,
        cost_total: shipment.costTotal,
        price_total: shipment.priceTotal,
        profit: shipment.profit,
        status: shipment.status,
        notes: shipment.notes,
      })),
      shipmentRules,
    );
    const normalizedOrders = normalizeSourceRows(
      parsedSource.orders.map((order) => ({
        ...order,
        client_old_id: order.oldClientId,
        client_name_match: order.clientName,
      })) as unknown as Record<string, unknown>[],
      'orderNumber',
      canonicalSources.orders as CanonicalSourceRules,
    );
    const normalizedAcceptedOrders = normalizedOrders.accepted as unknown as DirectOrderSource[];
    const days = options.days ?? 7;
    const cutoffKey = days > 0
      ? new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
      : null;
    const acceptedOrders = cutoffKey
      ? normalizedAcceptedOrders.filter((order) => order.date !== null && order.date >= cutoffKey)
      : normalizedAcceptedOrders;
    const recentShipmentNumbers = new Set(
      acceptedOrders.flatMap((order) => order.items.flatMap((item) => item.shipmentNumber ? [item.shipmentNumber] : [])),
    );
    const acceptedShipments = cutoffKey
      ? normalizedShipments.accepted.filter((shipment) => shipmentBelongsToWindow(shipment, cutoffKey, recentShipmentNumbers))
      : normalizedShipments.accepted;
    const hash = sourceHash(parsedSource);

    const result = await prisma.$transaction(async (tx) => {
      const lockRows = await tx.$queryRaw<Array<{ acquired: boolean }>>`
        select pg_try_advisory_xact_lock(hashtextextended('eswcargo-direct-operational-sync', 0)) as acquired
      `;
      if (!lockRows[0]?.acquired) throw new Error('Ya existe una sincronizacion directa en curso.');
      assertDeadline(deadline);

      const cloudRun = await tx.syncRun.findFirst({
        where: {
          status: 'RUNNING',
          scope: { in: ['DIFF', 'FULL'] },
          startedAt: { gte: new Date(Date.now() - 60 * 60_000) },
        },
        select: { id: true, scope: true },
      });
      if (cloudRun) {
        throw new Error(`Hay una reconciliacion cloud ${cloudRun.scope} en curso (run ${cloudRun.id}).`);
      }

      const runId = options.dryRun
        ? 0
        : (await tx.syncRun.create({ data: { scope: DIRECT_SCOPE, status: 'RUNNING' } })).id;
      const changes: Change[] = normalizedShipments.rejected.map((collision) => ({
        entity: 'SHIPMENT', entityKey: `#${collision.key}`, action: 'REJECTED',
        reason: 'CABE_ENVIOS contiene cabeceras incompatibles para el mismo envio.',
      }));
      changes.push(...normalizedOrders.rejected.map((collision) => ({
        entity: 'ORDER', entityKey: `#${collision.key}`, action: 'REJECTED' as const,
        reason: 'CABE_VENTAS contiene cabeceras incompatibles para el mismo pedido.',
      })));
      const summary: DirectSyncSummary = {
        sourceHash: hash,
        changed: 0,
        source: {
          shipments: acceptedShipments.length,
          orders: acceptedOrders.length,
          items: acceptedOrders.reduce((sum, order) => sum + order.items.length, 0),
        },
        created: { shipments: 0, orders: 0 },
        updated: { shipments: 0, orders: 0 },
        replaced: { orderItems: 0 },
        unchanged: { shipments: 0, orders: 0 },
        rejected: { shipments: normalizedShipments.rejected.length, orders: normalizedOrders.rejected.length },
        idempotent: false,
      };

      const [clients, products, existingShipments, existingOrders, unknownClient] = await Promise.all([
        tx.client.findMany({ select: { id: true, old_id: true, name: true } }),
        tx.product.findMany({ select: { id: true, sku: true } }),
        tx.shipment.findMany(),
        tx.order.findMany({ include: { items: { include: { _count: { select: { allocations: true } } } } } }),
        tx.client.findFirst({ where: { name: 'CLIENTE DESCONOCIDO' }, select: { id: true } }),
      ]);
      const clientsByOldId = new Map(clients.filter((client) => client.old_id !== null).map((client) => [client.old_id!, client]));
      const clientsByName = new Map(clients.map((client) => [nameKey(client.name), client]));
      const productsBySku = new Map(products.map((product) => [skuKey(product.sku), product]));
      const productsById = new Map(products.map((product) => [product.id, product]));
      const shipmentsByNumber = new Map(existingShipments.filter((shipment) => shipment.shipment_number !== null).map((shipment) => [shipment.shipment_number!, shipment]));

      for (const source of acceptedShipments) {
        assertDeadline(deadline);
        const shipmentNumber = Number(source.shipment_number);
        const existing = shipmentsByNumber.get(shipmentNumber);
        const client = source.old_client_id
          ? clientsByOldId.get(source.old_client_id)
          : clientsByName.get(nameKey(source.client_name_match));
        const data = {
          shipment_number: shipmentNumber,
          clientId: client?.id ?? existing?.clientId ?? null,
          forwarder: source.forwarder ?? null,
          date_shipped: dateFromKey(source.date_shipped ?? null),
          date_arrived: dateFromKey(source.date_arrived ?? null),
          weight_fw: Number(source.weight_fw || 0),
          weight_cli: Number(source.weight_cli || 0),
          type_load: source.type_load ?? null,
          item_count: source.item_count == null ? null : Number(source.item_count),
          cost_total: Number(source.cost_total || 0),
          price_total: Number(source.price_total || 0),
          profit: Number(source.profit || 0),
          status: directShipmentStatus({
            existingStatus: existing?.status,
            sourceStatus: source.status,
            dateShipped: source.date_shipped ?? null,
            dateArrived: source.date_arrived ?? null,
          }),
          notes: source.notes ?? null,
        };
        if (!existing) {
          const created = options.dryRun
            ? {
                id: -shipmentNumber,
                ...data,
                invoice: null,
                createdAt: new Date(),
                updatedAt: new Date(),
                email_sent_at: null,
                cargo_description: null,
              }
            : await tx.shipment.create({ data });
          shipmentsByNumber.set(shipmentNumber, created);
          summary.created.shipments++;
          changes.push({ entity: 'SHIPMENT', entityKey: `#${shipmentNumber}`, action: 'CREATED', reason: 'Nuevo envio en CABE_ENVIOS.', after: data });
          continue;
        }
        // The direct path is intentionally operational. Shared shipment headers
        // aggregate weights and financial totals differently in the historical
        // FULL importer, so changing those fields here would create false deltas.
        // FULL remains the only authority for weights, counts, costs and profit.
        const operationalData = {
          ...(client ? { clientId: client.id } : {}),
          forwarder: data.forwarder,
          date_shipped: data.date_shipped,
          date_arrived: data.date_arrived,
          status: data.status,
          notes: data.notes,
        };
        const patch = changedFieldPatch(existing, operationalData, {
          preserveBlank: ['status', 'forwarder', 'date_shipped', 'date_arrived', 'notes'],
        });
        if (Object.keys(patch).length === 0) {
          summary.unchanged.shipments++;
          continue;
        }
        const updated = options.dryRun
          ? { ...existing, ...patch }
          : await tx.shipment.update({ where: { id: existing.id }, data: patch });
        shipmentsByNumber.set(shipmentNumber, updated);
        summary.updated.shipments++;
        changes.push({ entity: 'SHIPMENT', entityKey: `#${shipmentNumber}`, action: 'UPDATED', reason: 'Cambio operativo confirmado en CABE_ENVIOS.', before: existing, after: patch });
      }

      const ordersByNumber = new Map(existingOrders.filter((order) => order.order_number !== null).map((order) => [order.order_number!, order]));
      for (const source of acceptedOrders) {
        assertDeadline(deadline);
        const existing = ordersByNumber.get(source.orderNumber);
        const client = source.oldClientId
          ? clientsByOldId.get(source.oldClientId)
          : clientsByName.get(nameKey(source.clientName));
        if (!existing && !client && !unknownClient) {
          summary.rejected.orders++;
          changes.push({ entity: 'ORDER', entityKey: `#${source.orderNumber}`, action: 'REJECTED', reason: 'Pedido nuevo sin cliente identificable.' });
          continue;
        }

        if (existing && source.items.length < existing.items.length) {
          summary.rejected.orders++;
          changes.push({
            entity: 'ORDER_ITEMS',
            entityKey: `#${source.orderNumber}`,
            action: 'REJECTED',
            reason: 'La fuente directa trajo menos items que Supabase; se conserva el pedido hasta verificar la fuente o autorizar una reduccion destructiva.',
          });
          continue;
        }

        const existingItemBuckets = new Map<string, typeof existingOrders[number]['items']>();
        for (const item of existing?.items ?? []) {
          const productSku = item.productId ? productsById.get(item.productId)?.sku : null;
          const key = productSku ? `S:${skuKey(productSku)}` : `N:${nameKey(item.productName)}`;
          const bucket = existingItemBuckets.get(key) ?? [];
          bucket.push(item);
          existingItemBuckets.set(key, bucket);
        }
        let invalidItemReason: string | null = null;
        const nextItems = source.items.map((item) => {
          const product = item.sku ? productsBySku.get(skuKey(item.sku)) : null;
          const shipment = item.shipmentNumber ? shipmentsByNumber.get(item.shipmentNumber) : null;
          const sourceKeys = [
            ...(item.sku ? [`S:${skuKey(item.sku)}`] : []),
            `N:${nameKey(item.productName ?? item.sku)}`,
          ];
          const matchingKey = sourceKeys.find((key) => (existingItemBuckets.get(key)?.length ?? 0) > 0);
          const matching = matchingKey ? existingItemBuckets.get(matchingKey)?.shift() : undefined;
          if (item.sku && !product && !matching) {
            invalidItemReason = `SKU desconocido ${item.sku} en pedido #${source.orderNumber}.`;
          }
          return {
            orderId: existing?.id ?? 0,
            productId: product?.id ?? matching?.productId ?? null,
            productName: item.productName ?? item.sku ?? 'Producto sin Nombre',
            quantity: item.quantity,
            unit_price: item.unitPrice,
            unit_cost: item.unitCost,
            shipping_cost: matching?.shipping_cost ?? null,
            subtotal: item.unitPrice * item.quantity,
            profit: item.profit,
            supplierId: matching?.supplierId ?? null,
            purchase_invoice: matching?.purchase_invoice ?? null,
            shipmentId: shipment?.id ?? null,
            status: item.status ?? matching?.status ?? null,
          };
        });
        const unmatchedProtectedItem = Array.from(existingItemBuckets.values())
          .flat()
          .find((item) => item._count.allocations > 0 || item.shipping_cost !== null || item.supplierId !== null || item.purchase_invoice !== null);
        if (invalidItemReason || unmatchedProtectedItem) {
          summary.rejected.orders++;
          changes.push({
            entity: 'ORDER_ITEMS',
            entityKey: `#${source.orderNumber}`,
            action: 'REJECTED',
            reason: invalidItemReason ?? 'El reemplazo perderia metadatos de compra o envio no presentes en Google Sheets.',
          });
          continue;
        }
        const totalAmount = calculateActiveOrderTotal(nextItems);
        const explicitStatuses = [...new Set(nextItems.map((item) => item.status).filter(Boolean))];
        const itemShipmentIds = [...new Set(nextItems.map((item) => item.shipmentId).filter((id): id is number => typeof id === 'number'))];
        const orderData = {
          order_number: source.orderNumber,
          clientId: client?.id ?? existing?.clientId ?? unknownClient!.id,
          date: dateFromKey(source.date) ?? existing?.date ?? new Date(),
          status: explicitStatuses.length === 1 ? explicitStatuses[0]! : source.status ?? existing?.status ?? 'COMPRAR',
          shipmentId: itemShipmentIds.length === 1 ? itemShipmentIds[0] : null,
          total_amount: totalAmount,
          paymentMethod: source.paymentMethod ?? existing?.paymentMethod ?? null,
        };
        if (existing && sourceWouldEraseExistingItems(source.items.length, existing.items.length)) {
          summary.rejected.orders++;
          changes.push({
            entity: 'ORDER_ITEMS',
            entityKey: `#${source.orderNumber}`,
            action: 'REJECTED',
            reason: 'DETA_VENTAS no devolvio items para un pedido que ya tiene detalle; se conserva el pedido hasta verificar la fuente.',
          });
          continue;
        }
        const itemsChanged = !existing || !sameItemSet(existing.items, nextItems);
        if (existing && itemsChanged && existing.items.some((item) => item._count.allocations > 0)) {
          summary.rejected.orders++;
          changes.push({ entity: 'ORDER_ITEMS', entityKey: `#${source.orderNumber}`, action: 'REJECTED', reason: 'El detalle tiene asignaciones de compra; no se modifica automaticamente.' });
          continue;
        }

        let orderId: number;
        if (!existing) {
          orderId = options.dryRun
            ? -source.orderNumber
            : (await tx.order.create({ data: orderData })).id;
          summary.created.orders++;
          changes.push({ entity: 'ORDER', entityKey: `#${source.orderNumber}`, action: 'CREATED', reason: 'Nuevo pedido en CABE_VENTAS.', after: orderData });
        } else {
          orderId = existing.id;
          const existingOrderScalar = {
            order_number: existing.order_number,
            clientId: existing.clientId,
            date: existing.date,
            status: existing.status,
            shipmentId: existing.shipmentId,
            total_amount: existing.total_amount,
            paymentMethod: existing.paymentMethod,
          };
          const patch = changedFieldPatch(existingOrderScalar, orderData, { preserveBlank: ['status', 'paymentMethod'] });
          if (Object.keys(patch).length > 0) {
            if (!options.dryRun) await tx.order.update({ where: { id: existing.id }, data: patch });
            summary.updated.orders++;
            changes.push({ entity: 'ORDER', entityKey: `#${source.orderNumber}`, action: 'UPDATED', reason: 'Cambio operativo confirmado en CABE_VENTAS/DETA_VENTAS.', before: existingOrderScalar, after: patch });
          } else if (!itemsChanged) {
            summary.unchanged.orders++;
          }
        }
        if (itemsChanged) {
          if (!options.dryRun) {
            if (existing) await tx.orderItem.deleteMany({ where: { orderId } });
            if (nextItems.length) await tx.orderItem.createMany({ data: nextItems.map((item) => ({ ...item, orderId })) });
          }
          summary.replaced.orderItems++;
          changes.push({
            entity: 'ORDER_ITEMS',
            entityKey: `#${source.orderNumber}`,
            action: 'REPLACED',
            reason: 'Cambio real en productos, cantidades, precios, estado o envio.',
            before: {
              count: existing?.items.length ?? 0,
              signatures: (existing?.items ?? []).map(itemSyncSignature).sort(),
            },
            after: {
              count: nextItems.length,
              signatures: nextItems.map(itemSyncSignature).sort(),
            },
          });
        }
      }

      if (changes.length && !options.dryRun) {
        const auditRows: Prisma.SyncChangeCreateManyInput[] = changes.map((change) => ({
          syncRunId: runId,
          entity: change.entity,
          entityKey: change.entityKey,
          action: change.action,
          reason: change.reason,
          ...(change.before ? { before: jsonSnapshot(change.before) } : {}),
          ...(change.after ? { after: jsonSnapshot(change.after) } : {}),
        }));
        await tx.syncChange.createMany({ data: auditRows });
      }
      const writeCount = summary.created.shipments + summary.created.orders + summary.updated.shipments
        + summary.updated.orders + summary.replaced.orderItems;
      summary.changed = writeCount;
      const rejectedCount = summary.rejected.shipments + summary.rejected.orders;
      summary.idempotent = writeCount === 0 && rejectedCount === 0;
      if (!options.dryRun) {
        await tx.syncRun.update({
          where: { id: runId },
          data: { status: 'SUCCESS', finishedAt: new Date(), summary },
        });
      }
      return {
        runId,
        summary,
        ...(options.dryRun ? {
          plannedChanges: changes.map((change) => ({
            entity: change.entity,
            entityKey: change.entityKey,
            action: change.action,
            reason: change.reason,
            fields: Object.keys(change.after ?? {}),
            ...(change.before ? { before: change.before } : {}),
            ...(change.after ? { after: change.after } : {}),
          })),
        } : {}),
      };
    }, { maxWait: 5_000, timeout: TRANSACTION_TIMEOUT_MS, isolationLevel: 'Serializable' });

    return { ...result, durationMs: Date.now() - startedAt };
  } catch (error) {
    if (options.dryRun) throw error;
    const message = error instanceof Error ? error.message : String(error);
    try {
      const failed = await prisma.syncRun.create({
        data: {
          scope: DIRECT_SCOPE,
          status: 'FAILED',
          finishedAt: new Date(),
          error: message.slice(0, 2_000),
          summary: parsedSource ? { sourceHash: sourceHash(parsedSource) } : undefined,
          changes: {
            create: { entity: 'SYNC', entityKey: 'DIRECT', action: 'REJECTED', reason: message.slice(0, 1_000) },
          },
        },
      });
      console.error(`Direct sheet sync failed (run ${failed.id}):`, error);
    } catch (auditError) {
      console.error('Direct sheet sync failed and could not persist its audit:', auditError);
    }
    throw error;
  }
}
