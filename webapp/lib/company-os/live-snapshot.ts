import { createHash } from 'node:crypto';
import { companyReadPrisma } from './read-prisma';
import type { CompanySnapshot } from './types';

const BUSINESS_TIME_ZONE = 'America/New_York' as const;

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

function iso(value: Date | null | undefined) {
  return value?.toISOString() ?? null;
}

export async function buildCompanySnapshot(now = new Date()): Promise<CompanySnapshot> {
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const delayedBefore = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const activeShipmentStatuses = [
    'SALIENDO',
    'LLEGANDO',
    'EN TRANSITO',
    'EN TRANSITO A ARG',
    'EN TRANSITO ARG',
    'MIAMI',
    'PARCIAL',
  ];

  const [
    ordersLast7Days,
    orderStatus,
    ordersToBuy,
    productsActive,
    stock,
    productsWithoutStock,
    shipmentStatus,
    shipmentsInTransit,
    delayedShipments,
    pendingPurchases,
    expenses,
    latestOrder,
    latestProduct,
    latestShipment,
    latestSync,
  ] = await Promise.all([
    companyReadPrisma().order.groupBy({
      by: ['currency'],
      where: {
        date: { gte: sevenDaysAgo },
        status: { not: 'CANCELADO' },
        order_number: { lt: 900000 },
      },
      _count: { id: true },
      _sum: { total_amount: true },
    }),
    companyReadPrisma().order.groupBy({
      by: ['status'],
      where: { status: { not: 'CANCELADO' }, order_number: { lt: 900000 } },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    }),
    companyReadPrisma().order.count({
      where: { status: { in: ['COMPRAR', 'RESERVADO'] }, order_number: { lt: 900000 } },
    }),
    companyReadPrisma().product.count({ where: { active: true } }),
    companyReadPrisma().product.aggregate({ where: { active: true }, _sum: { stock: true } }),
    companyReadPrisma().product.count({ where: { active: true, stock: { lte: 0 } } }),
    companyReadPrisma().shipment.groupBy({
      by: ['status'],
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    }),
    companyReadPrisma().shipment.count({
      where: { status: { in: activeShipmentStatuses }, date_arrived: null },
    }),
    companyReadPrisma().shipment.count({
      where: {
        status: { in: activeShipmentStatuses },
        date_arrived: null,
        date_shipped: { lt: delayedBefore },
      },
    }),
    companyReadPrisma().purchase.aggregate({
      where: { balance_due: { gt: 0.005 } },
      _count: { id: true },
      _sum: { balance_due: true },
    }),
    companyReadPrisma().expense.aggregate({
      where: { date: { gte: thirtyDaysAgo } },
      _sum: { amount: true },
    }),
    companyReadPrisma().order.findFirst({ orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
    companyReadPrisma().product.findFirst({ orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
    companyReadPrisma().shipment.findFirst({ orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
    companyReadPrisma().syncRun.findFirst({
      where: { scope: { in: ['DIRECT_OPERATIONAL', 'DIFF', 'FULL'] } },
      orderBy: { startedAt: 'desc' },
    }),
  ]);

  const generatedAt = now.toISOString();
  const usdOrders = ordersLast7Days.find((row) => row.currency.trim().toUpperCase() === 'USD');
  const nonUsdOrders = ordersLast7Days
    .filter((row) => row.currency.trim().toUpperCase() !== 'USD')
    .reduce((sum, row) => sum + row._count.id, 0);
  const latestSyncAgeHours = latestSync
    ? Math.max(0, (now.getTime() - latestSync.startedAt.getTime()) / (60 * 60 * 1000))
    : null;
  const snapshotBase = {
    generatedAt,
    businessDate: dateKeyInTimeZone(now),
    timeZone: BUSINESS_TIME_ZONE,
    source: 'ESWCARGO_PRODUCTION_READ_ONLY' as const,
    metrics: {
      ordersLast7Days: ordersLast7Days.reduce((sum, row) => sum + row._count.id, 0),
      revenueLast7DaysUsd: roundMoney(usdOrders?._sum.total_amount),
      ordersNonUsdLast7Days: nonUsdOrders,
      ordersToBuy,
      productsActive,
      unitsInStock: stock._sum.stock ?? 0,
      productsWithoutStock,
      shipmentsInTransit,
      delayedShipments,
      purchasesPending: pendingPurchases._count.id,
      purchasesBalanceUsd: roundMoney(pendingPurchases._sum.balance_due),
      expensesLast30DaysUsd: roundMoney(expenses._sum.amount),
    },
    distributions: {
      orderStatus: orderStatus.map((row) => ({ status: row.status, count: row._count.id })),
      shipmentStatus: shipmentStatus.map((row) => ({ status: row.status, count: row._count.id })),
    },
    freshness: {
      latestOrderUpdate: iso(latestOrder?.updatedAt),
      latestProductUpdate: iso(latestProduct?.updatedAt),
      latestShipmentUpdate: iso(latestShipment?.updatedAt),
      latestSync: latestSync
        ? {
            id: latestSync.id,
            status: latestSync.status,
            scope: latestSync.scope,
            startedAt: latestSync.startedAt.toISOString(),
            finishedAt: iso(latestSync.finishedAt),
            ageHours: Math.round((latestSyncAgeHours ?? 0) * 10) / 10,
            fresh: latestSync.status === 'SUCCESS' && latestSyncAgeHours != null && latestSyncAgeHours <= 24,
          }
        : null,
    },
  };

  const stableSnapshot = { ...snapshotBase, generatedAt: undefined };
  const snapshotId = createHash('sha256')
    .update(JSON.stringify(stableSnapshot))
    .digest('hex')
    .slice(0, 16);

  return { snapshotId, ...snapshotBase };
}
