import { createHash } from 'node:crypto';
import { companyReadPrisma } from './read-prisma';
import type {
  ActionableProduct,
  CompanyMetricKey,
  CompanySnapshot,
  DelayedShipmentDossier,
  MetricQualityProfile,
} from './types';

const BUSINESS_TIME_ZONE = 'America/New_York' as const;
const DAY_MS = 24 * 60 * 60 * 1000;
const PENDING_ORDER_STATUSES = new Set(['COMPRAR', 'RESERVADO', 'ENCARGADO']);
const TERMINAL_ITEM_STATUSES = new Set(['CANCELADO', 'ENTREGADO', 'FINALIZADO']);
const INACTIVE_PRODUCT_STATUSES = new Set(['INACTIVO', 'DE BAJA', 'DISCONTINUADO', 'OBSOLETO', 'ARCHIVADO']);

type ProductSignalInput = {
  productId: number;
  sku: string;
  active: boolean;
  status: string | null;
  stock: number;
  orderItems: Array<{
    quantity: number;
    unitPrice: number;
    unitCost: number;
    shippingCost: number;
    profit: number;
    status: string | null;
    allocatedQuantity: number;
    order: {
      id: number;
      status: string;
      date: Date;
      updatedAt: Date;
      currency: string;
      orderNumber: number | null;
    };
  }>;
};

type InquirySignal = {
  product_id: number | null;
  sku: string | null;
  message_at: Date;
  match_confidence: string;
  conflict: boolean;
};

type AvailabilitySignal = {
  product_id: number | null;
  sku: string | null;
  quantity: unknown;
  unit_price: unknown;
  currency: string;
  confidence: unknown;
  offered_at: Date;
  needs_review: boolean;
};

type OptionalSource<T> = { covered: boolean; rows: T[]; maxObservedAt: Date | null };

type DelayedShipmentRow = {
  shipment_number: number | null;
  status: string;
  date_shipped: Date;
  updated_at: Date;
  linked_orders: number;
  linked_items: number;
  tracking_references: number;
};

function normalized(value: string | null | undefined) {
  return (value ?? '').trim().toUpperCase();
}

function dateKeyInTimeZone(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function roundMoney(value: number | null | undefined) {
  return Math.round((value ?? 0) * 100) / 100;
}

function numeric(value: unknown) {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  const parsed = Number(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function iso(value: Date | null | undefined) {
  return value?.toISOString() ?? null;
}

function freshness(maxObservedAt: Date | null, now: Date, maxAgeHours = 24): MetricQualityProfile['freshness'] {
  if (!maxObservedAt) return 'UNKNOWN';
  return now.getTime() - maxObservedAt.getTime() <= maxAgeHours * 60 * 60 * 1000 ? 'FRESH' : 'STALE';
}

function profile(input: Omit<MetricQualityProfile, 'freshness' | 'maxDateOrUpdate'> & {
  maxObservedAt: Date | null;
  now: Date;
  maxAgeHours?: number;
}): MetricQualityProfile {
  return {
    count: input.count,
    maxDateOrUpdate: iso(input.maxObservedAt),
    freshness: freshness(input.maxObservedAt, input.now, input.maxAgeHours),
    coverage: input.coverage,
    currency: input.currency,
    confidence: input.confidence,
  };
}

export function zeroNeedsQualityGap(value: number, metricQuality: MetricQualityProfile) {
  return value === 0 && (
    metricQuality.coverage !== 'COMPLETE'
    || metricQuality.confidence !== 'HIGH'
    || metricQuality.freshness !== 'FRESH'
    || metricQuality.currency === 'UNKNOWN'
    || metricQuality.currency === 'MIXED'
  );
}

function matchesProduct(signal: { product_id: number | null; sku: string | null }, product: ProductSignalInput) {
  return signal.product_id === product.productId
    || (normalized(signal.sku).length > 0 && normalized(signal.sku) === normalized(product.sku));
}

export function calibrateActionableProducts(input: {
  products: ProductSignalInput[];
  inquiries: OptionalSource<InquirySignal>;
  availability: OptionalSource<AvailabilitySignal>;
  now: Date;
}): ActionableProduct[] {
  if (
    !input.inquiries.covered
    || !input.availability.covered
    || freshness(input.inquiries.maxObservedAt, input.now, 30 * 24) !== 'FRESH'
    || freshness(input.availability.maxObservedAt, input.now, 24) !== 'FRESH'
  ) return [];
  const thirtyDaysAgo = new Date(input.now.getTime() - 30 * DAY_MS);
  const ninetyDaysAgo = new Date(input.now.getTime() - 90 * DAY_MS);
  const offerCutoff = new Date(input.now.getTime() - DAY_MS);

  return input.products.flatMap((product) => {
    if (!product.active || product.stock > 0 || INACTIVE_PRODUCT_STATUSES.has(normalized(product.status))) return [];
    const validItems = product.orderItems.filter((item) =>
      (item.order.orderNumber == null || item.order.orderNumber < 900000)
      && normalized(item.order.status) !== 'CANCELADO'
      && !TERMINAL_ITEM_STATUSES.has(normalized(item.status)));
    const pendingUnits = validItems
      .filter((item) => PENDING_ORDER_STATUSES.has(normalized(item.order.status)) && item.order.updatedAt >= thirtyDaysAgo)
      .reduce((sum, item) => sum + Math.max(0, item.quantity - item.allocatedQuantity), 0);
    const soldItems = validItems.filter((item) =>
      item.order.date >= ninetyDaysAgo
      && !PENDING_ORDER_STATUSES.has(normalized(item.order.status))
      && normalized(item.order.currency) === 'USD');
    const soldUnits90Days = soldItems.reduce((sum, item) => sum + Math.max(0, item.quantity), 0);
    const soldOrders90Days = new Set(soldItems.map((item) => item.order.id)).size;
    const recentInquiryCount = input.inquiries.rows.filter((signal) =>
      signal.message_at >= thirtyDaysAgo
      && !signal.conflict
      && ['HIGH', 'MEDIUM', 'ALTA', 'MEDIA', 'HIGH_EXACT_SKU'].includes(normalized(signal.match_confidence))
      && matchesProduct(signal, product)).length;
    const hasDemand = pendingUnits > 0
      || (soldUnits90Days >= 2 && soldOrders90Days >= 2)
      || (soldUnits90Days >= 1 && recentInquiryCount >= 1);
    if (!hasDemand) return [];

    const marginItems = validItems.filter((item) =>
      normalized(item.order.currency) === 'USD'
      && item.unitPrice > 0
      && item.unitCost > 0
      && item.unitPrice - item.unitCost - item.shippingCost > 0);
    const marginRevenue = marginItems.reduce((sum, item) => sum + item.unitPrice * Math.max(0, item.quantity), 0);
    const marginProfit = marginItems.reduce(
      (sum, item) => sum + (item.unitPrice - item.unitCost - item.shippingCost) * Math.max(0, item.quantity),
      0,
    );
    if (marginRevenue <= 0 || marginProfit <= 0) return [];

    const offers = input.availability.rows.filter((signal) =>
      signal.offered_at >= offerCutoff
      && numeric(signal.quantity) > 0
      && numeric(signal.unit_price) > 0
      && normalized(signal.currency) === 'USD'
      && numeric(signal.confidence) >= 0.8
      && !signal.needs_review
      && matchesProduct(signal, product));
    if (offers.length === 0) return [];
    const latestOffer = offers.reduce((latest, signal) => signal.offered_at > latest ? signal.offered_at : latest, offers[0].offered_at);

    return [{
      productId: product.productId,
      sku: product.sku,
      pendingUnits,
      soldUnits90Days,
      soldOrders90Days,
      recentInquiryCount,
      grossMarginPct: Math.round((marginProfit / marginRevenue) * 10_000) / 100,
      availableUnits: offers.reduce((sum, signal) => sum + numeric(signal.quantity), 0),
      supplierOfferAt: latestOffer.toISOString(),
    }];
  }).sort((a, b) =>
    b.pendingUnits - a.pendingUnits
    || b.recentInquiryCount - a.recentInquiryCount
    || b.soldUnits90Days - a.soldUnits90Days
    || b.grossMarginPct - a.grossMarginPct);
}

export function classifyDelayedShipment(input: {
  shipmentNumber: number | null;
  status: string;
  dateShipped: Date;
  updatedAt: Date;
  now: Date;
  linkedOrders: number;
  linkedItems: number;
  trackingReferences: number;
}): DelayedShipmentDossier | null {
  const status = normalized(input.status);
  if (!['SALIENDO', 'LLEGANDO'].includes(status) || input.shipmentNumber == null) return null;
  const ageDays = Math.floor((input.now.getTime() - input.dateShipped.getTime()) / DAY_MS);
  if (ageDays <= 14) return null;
  const gaps: string[] = [];
  if (input.linkedOrders === 0) gaps.push('NO_LINKED_ORDERS');
  if (input.linkedItems === 0) gaps.push('NO_LINKED_ITEMS');
  if (input.trackingReferences === 0) gaps.push('NO_TRACKING_REFERENCE');
  return {
    shipmentNumber: input.shipmentNumber,
    status: status as 'SALIENDO' | 'LLEGANDO',
    dateShipped: input.dateShipped.toISOString(),
    ageDays,
    updatedAt: input.updatedAt.toISOString(),
    linkedOrders: input.linkedOrders,
    linkedItems: input.linkedItems,
    trackingReferences: input.trackingReferences,
    classification: input.linkedOrders === 0 && input.linkedItems === 0 ? 'BLOCKED' : 'REVIEW',
    gaps,
  };
}

async function loadInquirySignals(now: Date): Promise<OptionalSource<InquirySignal>> {
  try {
    const rows = await companyReadPrisma().$queryRaw<InquirySignal[]>`
      SELECT product_id, sku, message_at, match_confidence, conflict
      FROM company_os_source.recent_product_inquiries
      WHERE message_at >= ${new Date(now.getTime() - 30 * DAY_MS)}
    `;
    return {
      covered: true,
      rows,
      maxObservedAt: rows.reduce<Date | null>((latest, row) => !latest || row.message_at > latest ? row.message_at : latest, null),
    };
  } catch {
    return { covered: false, rows: [], maxObservedAt: null };
  }
}

async function loadAvailabilitySignals(now: Date): Promise<OptionalSource<AvailabilitySignal>> {
  try {
    const rows = await companyReadPrisma().$queryRaw<AvailabilitySignal[]>`
      SELECT product_id, sku, quantity, unit_price, currency, confidence, offered_at, needs_review
      FROM company_os_source.supplier_availability
      WHERE offered_at >= ${new Date(now.getTime() - DAY_MS)}
    `;
    return {
      covered: true,
      rows,
      maxObservedAt: rows.reduce<Date | null>((latest, row) => !latest || row.offered_at > latest ? row.offered_at : latest, null),
    };
  } catch {
    return { covered: false, rows: [], maxObservedAt: null };
  }
}

export async function buildCompanySnapshot(now = new Date()): Promise<CompanySnapshot> {
  const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * DAY_MS);
  const delayedBefore = new Date(now.getTime() - 14 * DAY_MS);
  const db = companyReadPrisma();

  const [
    ordersLast7Days,
    orderStatus,
    ordersToBuy,
    productsActive,
    stock,
    productsWithoutStockRaw,
    productCandidates,
    shipmentStatus,
    shipmentsInTransit,
    delayedShipmentRows,
    pendingPurchases,
    expenses,
    latestExpense,
    latestOrder,
    latestProduct,
    latestShipment,
    latestPurchase,
    latestSync,
    inquiries,
    availability,
  ] = await Promise.all([
    db.order.groupBy({
      by: ['currency'],
      where: { date: { gte: sevenDaysAgo }, status: { not: 'CANCELADO' }, order_number: { lt: 900000 } },
      _count: { id: true },
      _sum: { total_amount: true },
    }),
    db.order.groupBy({
      by: ['status'],
      where: { status: { not: 'CANCELADO' }, order_number: { lt: 900000 } },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    }),
    db.order.count({ where: { status: { in: ['COMPRAR', 'RESERVADO', 'ENCARGADO'] }, order_number: { lt: 900000 } } }),
    db.product.count({ where: { active: true } }),
    db.product.aggregate({ where: { active: true }, _sum: { stock: true } }),
    db.product.count({ where: { active: true, stock: { lte: 0 } } }),
    db.product.findMany({
      where: { active: true, stock: { lte: 0 } },
      select: {
        id: true,
        sku: true,
        active: true,
        status: true,
        stock: true,
        orderItems: {
          where: {
            order: {
              status: { not: 'CANCELADO' },
              order_number: { lt: 900000 },
              OR: [{ date: { gte: ninetyDaysAgo } }, { updatedAt: { gte: thirtyDaysAgo } }],
            },
          },
          select: {
            quantity: true,
            unit_price: true,
            unit_cost: true,
            shipping_cost: true,
            profit: true,
            status: true,
            allocations: { select: { quantity: true } },
            order: { select: { id: true, status: true, date: true, updatedAt: true, currency: true, order_number: true } },
          },
        },
      },
    }),
    db.shipment.groupBy({ by: ['status'], _count: { id: true }, orderBy: { _count: { id: 'desc' } } }),
    db.shipment.count({ where: { status: { in: ['SALIENDO', 'LLEGANDO'] }, date_arrived: null } }),
    db.$queryRaw<DelayedShipmentRow[]>`
      SELECT
        s.shipment_number,
        s.status,
        s.date_shipped,
        s."updatedAt" AS updated_at,
        COUNT(DISTINCT o.id)::int AS linked_orders,
        COUNT(DISTINCT oi.id)::int AS linked_items,
        COUNT(DISTINCT CASE
          WHEN NULLIF(btrim(o.tracking_number), '') IS NOT NULL THEN o.id
          ELSE NULL
        END)::int AS tracking_references
      FROM "Shipment" AS s
      LEFT JOIN "Order" AS o ON o."shipmentId" = s.id
      LEFT JOIN "OrderItem" AS oi
        ON oi."shipmentId" = s.id OR (o.id IS NOT NULL AND oi."orderId" = o.id)
      WHERE s.status IN ('SALIENDO', 'LLEGANDO')
        AND s.date_arrived IS NULL
        AND s.date_shipped < ${delayedBefore}
      GROUP BY s.id, s.shipment_number, s.status, s.date_shipped, s."updatedAt"
      ORDER BY s.date_shipped ASC
    `,
    db.purchase.aggregate({ where: { balance_due: { gt: 0.005 } }, _count: { id: true }, _sum: { balance_due: true } }),
    db.expense.aggregate({ where: { date: { gte: thirtyDaysAgo }, status: { notIn: ['CANCELLED', 'CANCELADO', 'ANULADO'] } }, _count: { id: true }, _sum: { amount: true }, _max: { date: true, updatedAt: true } }),
    db.expense.findFirst({ orderBy: { date: 'desc' }, select: { date: true, updatedAt: true } }),
    db.order.findFirst({ orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
    db.product.findFirst({ orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
    db.shipment.findFirst({ orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
    db.purchase.findFirst({ orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
    db.syncRun.findFirst({ where: { scope: { in: ['DIRECT_OPERATIONAL', 'DIFF', 'FULL', 'DIRECT_STATUS_RECOVERY'] } }, orderBy: { startedAt: 'desc' } }),
    loadInquirySignals(now),
    loadAvailabilitySignals(now),
  ]);

  const products = productCandidates.map((product) => ({
    productId: product.id,
    sku: product.sku,
    active: product.active,
    status: product.status,
    stock: product.stock,
    orderItems: product.orderItems.map((item) => ({
      quantity: item.quantity,
      unitPrice: item.unit_price,
      unitCost: item.unit_cost,
      shippingCost: item.shipping_cost ?? 0,
      profit: item.profit,
      status: item.status,
      allocatedQuantity: item.allocations.reduce((sum, allocation) => sum + allocation.quantity, 0),
      order: {
        id: item.order.id,
        status: item.order.status,
        date: item.order.date,
        updatedAt: item.order.updatedAt,
        currency: item.order.currency,
        orderNumber: item.order.order_number,
      },
    })),
  }));
  const actionableProducts = calibrateActionableProducts({ products, inquiries, availability, now });
  const delayedShipmentDossiers = delayedShipmentRows.flatMap((shipment) => {
    if (!shipment.date_shipped) return [];
    const dossier = classifyDelayedShipment({
      shipmentNumber: shipment.shipment_number,
      status: shipment.status,
      dateShipped: shipment.date_shipped,
      updatedAt: shipment.updated_at,
      now,
      linkedOrders: shipment.linked_orders,
      linkedItems: shipment.linked_items,
      trackingReferences: shipment.tracking_references,
    });
    return dossier ? [dossier] : [];
  });

  const generatedAt = now.toISOString();
  const usdOrders = ordersLast7Days.find((row) => normalized(row.currency) === 'USD');
  const nonUsdOrders = ordersLast7Days.filter((row) => normalized(row.currency) !== 'USD').reduce((sum, row) => sum + row._count.id, 0);
  const ordersCount = ordersLast7Days.reduce((sum, row) => sum + row._count.id, 0);
  const latestSyncAgeHours = latestSync ? Math.max(0, (now.getTime() - latestSync.startedAt.getTime()) / (60 * 60 * 1000)) : null;
  const syncFresh = latestSync?.status === 'SUCCESS' && latestSyncAgeHours != null && latestSyncAgeHours <= 24;
  const inquiryFresh = inquiries.covered && freshness(inquiries.maxObservedAt, now, 30 * 24) === 'FRESH';
  const availabilityFresh = availability.covered && freshness(availability.maxObservedAt, now, 24) === 'FRESH';
  const productCoverage = inquiryFresh && availabilityFresh;
  const expenseLatestObserved = latestExpense
    ? (latestExpense.updatedAt > latestExpense.date ? latestExpense.updatedAt : latestExpense.date)
    : null;

  const metrics = {
    ordersLast7Days: ordersCount,
    revenueLast7DaysUsd: roundMoney(usdOrders?._sum.total_amount),
    ordersNonUsdLast7Days: nonUsdOrders,
    ordersToBuy,
    productsActive,
    unitsInStock: stock._sum.stock ?? 0,
    productsWithoutStockRaw,
    actionableProductsWithoutStock: actionableProducts.length,
    shipmentsInTransit,
    delayedShipments: delayedShipmentDossiers.length,
    purchasesPending: pendingPurchases._count.id,
    purchasesBalanceUsd: roundMoney(pendingPurchases._sum.balance_due),
    expensesLast30DaysUsd: roundMoney(expenses._sum.amount),
  };

  const metricProfiles: Record<CompanyMetricKey, MetricQualityProfile> = {
    ordersLast7Days: profile({ count: ordersCount, maxObservedAt: latestOrder?.updatedAt ?? null, now, coverage: syncFresh ? 'COMPLETE' : 'PARTIAL', currency: 'COUNT', confidence: syncFresh ? 'HIGH' : 'MEDIUM' }),
    revenueLast7DaysUsd: profile({ count: usdOrders?._count.id ?? 0, maxObservedAt: latestOrder?.updatedAt ?? null, now, coverage: nonUsdOrders === 0 && syncFresh ? 'COMPLETE' : 'PARTIAL', currency: nonUsdOrders === 0 ? 'USD' : 'MIXED', confidence: nonUsdOrders === 0 && syncFresh ? 'HIGH' : 'MEDIUM' }),
    ordersNonUsdLast7Days: profile({ count: nonUsdOrders, maxObservedAt: latestOrder?.updatedAt ?? null, now, coverage: syncFresh ? 'COMPLETE' : 'PARTIAL', currency: 'COUNT', confidence: syncFresh ? 'HIGH' : 'MEDIUM' }),
    ordersToBuy: profile({ count: ordersToBuy, maxObservedAt: latestOrder?.updatedAt ?? null, now, coverage: syncFresh ? 'COMPLETE' : 'PARTIAL', currency: 'COUNT', confidence: syncFresh ? 'HIGH' : 'MEDIUM' }),
    productsActive: profile({ count: productsActive, maxObservedAt: latestProduct?.updatedAt ?? null, now, coverage: syncFresh ? 'COMPLETE' : 'PARTIAL', currency: 'COUNT', confidence: syncFresh ? 'HIGH' : 'MEDIUM' }),
    unitsInStock: profile({ count: productsActive, maxObservedAt: latestProduct?.updatedAt ?? null, now, coverage: syncFresh ? 'COMPLETE' : 'PARTIAL', currency: 'COUNT', confidence: syncFresh ? 'HIGH' : 'MEDIUM' }),
    productsWithoutStockRaw: profile({ count: productsWithoutStockRaw, maxObservedAt: latestProduct?.updatedAt ?? null, now, coverage: syncFresh ? 'COMPLETE' : 'PARTIAL', currency: 'COUNT', confidence: syncFresh ? 'HIGH' : 'MEDIUM' }),
    actionableProductsWithoutStock: profile({ count: actionableProducts.length, maxObservedAt: availability.maxObservedAt, now, coverage: productCoverage ? 'COMPLETE' : 'UNKNOWN', currency: 'COUNT', confidence: productCoverage ? 'HIGH' : 'LOW' }),
    shipmentsInTransit: profile({ count: shipmentsInTransit, maxObservedAt: latestShipment?.updatedAt ?? null, now, coverage: syncFresh ? 'COMPLETE' : 'PARTIAL', currency: 'COUNT', confidence: syncFresh ? 'HIGH' : 'MEDIUM' }),
    delayedShipments: profile({ count: delayedShipmentDossiers.length, maxObservedAt: latestShipment?.updatedAt ?? null, now, coverage: syncFresh ? 'COMPLETE' : 'PARTIAL', currency: 'COUNT', confidence: syncFresh ? 'HIGH' : 'MEDIUM' }),
    purchasesPending: profile({ count: pendingPurchases._count.id, maxObservedAt: latestPurchase?.updatedAt ?? null, now, coverage: syncFresh ? 'COMPLETE' : 'PARTIAL', currency: 'COUNT', confidence: syncFresh ? 'HIGH' : 'MEDIUM' }),
    purchasesBalanceUsd: profile({ count: pendingPurchases._count.id, maxObservedAt: latestPurchase?.updatedAt ?? null, now, coverage: 'PARTIAL', currency: 'UNKNOWN', confidence: 'LOW' }),
    expensesLast30DaysUsd: profile({ count: expenses._count.id, maxObservedAt: expenseLatestObserved, now, maxAgeHours: 30 * 24, coverage: 'UNKNOWN', currency: 'UNKNOWN', confidence: 'LOW' }),
  };
  const qualityGaps: string[] = [];
  if (!inquiries.covered) qualityGaps.push('PRODUCT_INQUIRY_COVERAGE_UNKNOWN');
  else if (!inquiryFresh) qualityGaps.push('PRODUCT_INQUIRY_EMPTY_OR_STALE');
  if (!availability.covered) qualityGaps.push('PRODUCT_AVAILABILITY_COVERAGE_UNKNOWN');
  else if (!availabilityFresh) qualityGaps.push('PRODUCT_AVAILABILITY_EMPTY_OR_STALE');
  if (expenses._count.id === 0) qualityGaps.push('EXPENSE_COVERAGE_UNKNOWN');
  if (metricProfiles.expensesLast30DaysUsd.currency !== 'USD') qualityGaps.push('EXPENSE_CURRENCY_UNKNOWN');
  for (const key of Object.keys(metrics) as CompanyMetricKey[]) {
    if (zeroNeedsQualityGap(metrics[key], metricProfiles[key])) {
      qualityGaps.push(`${key.toUpperCase()}_ZERO_UNVERIFIED`);
    }
  }

  const snapshotBase = {
    generatedAt,
    businessDate: dateKeyInTimeZone(now),
    timeZone: BUSINESS_TIME_ZONE,
    source: 'ESWCARGO_PRODUCTION_READ_ONLY' as const,
    metrics,
    distributions: {
      orderStatus: orderStatus.map((row) => ({ status: row.status, count: row._count.id })),
      shipmentStatus: shipmentStatus.map((row) => ({ status: row.status, count: row._count.id })),
    },
    calibration: { actionableProducts, delayedShipmentDossiers },
    quality: { metrics: metricProfiles, gaps: [...new Set(qualityGaps)] },
    freshness: {
      latestOrderUpdate: iso(latestOrder?.updatedAt),
      latestProductUpdate: iso(latestProduct?.updatedAt),
      latestShipmentUpdate: iso(latestShipment?.updatedAt),
      latestSync: latestSync ? {
        id: latestSync.id,
        status: latestSync.status,
        scope: latestSync.scope,
        startedAt: latestSync.startedAt.toISOString(),
        finishedAt: iso(latestSync.finishedAt),
        ageHours: Math.round((latestSyncAgeHours ?? 0) * 10) / 10,
        fresh: syncFresh,
      } : null,
    },
  };

  const stableSnapshot = { ...snapshotBase, generatedAt: undefined };
  const snapshotId = createHash('sha256').update(JSON.stringify(stableSnapshot)).digest('hex').slice(0, 16);
  return { snapshotId, ...snapshotBase };
}
