import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildDeterministicFallback } from '../lib/company-os/general-manager';
import { calibrateActionableProducts, classifyDelayedShipment, zeroNeedsQualityGap } from '../lib/company-os/live-snapshot';
import type { CompanySnapshot } from '../lib/company-os/types';

const NOW = new Date('2026-08-15T16:00:00.000Z');

function product(overrides: Record<string, unknown> = {}) {
  return {
    productId: 10,
    sku: 'IP16-128-BLK',
    active: true,
    status: 'ACTIVO',
    stock: 0,
    orderItems: [{
      quantity: 2,
      unitPrice: 900,
      unitCost: 750,
      shippingCost: 20,
      profit: 260,
      status: 'PENDIENTE',
      allocatedQuantity: 0,
      order: {
        id: 100,
        status: 'COMPRAR',
        date: new Date('2026-06-01T12:00:00.000Z'),
        updatedAt: new Date('2026-08-10T12:00:00.000Z'),
        currency: 'USD',
        orderNumber: 100,
      },
    }],
    ...overrides,
  };
}

function signals() {
  return {
    inquiries: {
      covered: true,
      maxObservedAt: new Date('2026-08-14T12:00:00.000Z'),
      rows: [{
        product_id: 10,
        sku: 'IP16-128-BLK',
        message_at: new Date('2026-08-14T12:00:00.000Z'),
        match_confidence: 'HIGH_EXACT_SKU',
        conflict: false,
      }],
    },
    availability: {
      covered: true,
      maxObservedAt: new Date('2026-08-15T12:00:00.000Z'),
      rows: [{
        product_id: 10,
        sku: 'IP16-128-BLK',
        quantity: '5',
        unit_price: 730,
        currency: 'USD',
        confidence: 0.95,
        offered_at: new Date('2026-08-15T12:00:00.000Z'),
        needs_review: false,
      }],
    },
  };
}

test('ranking exige demanda, margen positivo y oferta USD fresca de alta confianza', () => {
  const result = calibrateActionableProducts({ products: [product()], ...signals(), now: NOW });
  assert.equal(result.length, 1);
  assert.equal(result[0].pendingUnits, 2);
  assert.equal(result[0].recentInquiryCount, 1);
  assert.equal(result[0].availableUnits, 5);
  assert.equal(result[0].grossMarginPct, 14.44);
});

test('excluye producto de baja, sin demanda, margen dudoso o cobertura externa stale', () => {
  const base = signals();
  assert.deepEqual(calibrateActionableProducts({ products: [product({ status: 'DE BAJA' })], ...base, now: NOW }), []);
  assert.deepEqual(calibrateActionableProducts({ products: [product({ orderItems: [] })], ...base, now: NOW }), []);
  assert.deepEqual(calibrateActionableProducts({
    products: [product({ orderItems: [{ ...product().orderItems[0], unitCost: 950 }] })],
    ...base,
    now: NOW,
  }), []);
  assert.deepEqual(calibrateActionableProducts({
    products: [product()],
    ...base,
    availability: { ...base.availability, maxObservedAt: new Date('2026-08-13T12:00:00.000Z') },
    now: NOW,
  }), []);
});

test('clasifica expedientes demorados según enlaces operativos sin exponer tracking', () => {
  const common = {
    status: 'LLEGANDO',
    dateShipped: new Date('2025-09-10T12:00:00.000Z'),
    updatedAt: new Date('2026-08-15T12:00:00.000Z'),
    now: NOW,
    linkedItems: 0,
    trackingReferences: 0,
  };
  const shipment628 = classifyDelayedShipment({ ...common, shipmentNumber: 628, linkedOrders: 0 });
  const shipment629 = classifyDelayedShipment({ ...common, shipmentNumber: 629, linkedOrders: 0 });
  const shipment631 = classifyDelayedShipment({ ...common, shipmentNumber: 631, linkedOrders: 1 });
  assert.equal(shipment628?.classification, 'BLOCKED');
  assert.equal(shipment629?.classification, 'BLOCKED');
  assert.equal(shipment631?.classification, 'REVIEW');
  assert.deepEqual(shipment631?.gaps, ['NO_LINKED_ITEMS', 'NO_TRACKING_REFERENCE']);
  assert.equal(JSON.stringify(shipment631).includes('tracking_number'), false);
});

test('rechaza estados fuera de SALIENDO/LLEGANDO y antigüedad no superior a 14 días', () => {
  const base = {
    shipmentNumber: 700,
    dateShipped: new Date('2026-08-10T12:00:00.000Z'),
    updatedAt: NOW,
    now: NOW,
    linkedOrders: 1,
    linkedItems: 1,
    trackingReferences: 1,
  };
  assert.equal(classifyDelayedShipment({ ...base, status: 'LLEGANDO' }), null);
  assert.equal(classifyDelayedShipment({ ...base, status: 'MIAMI', dateShipped: new Date('2026-01-01T12:00:00.000Z') }), null);
});

test('cero gastos sin moneda ni cobertura nunca deja dataQuality.gaps vacío', () => {
  const keys = [
    'ordersLast7Days', 'revenueLast7DaysUsd', 'ordersNonUsdLast7Days', 'ordersToBuy',
    'productsActive', 'unitsInStock', 'productsWithoutStockRaw', 'actionableProductsWithoutStock',
    'shipmentsInTransit', 'delayedShipments', 'purchasesPending', 'purchasesBalanceUsd',
    'expensesLast30DaysUsd',
  ] as const;
  const profiles = Object.fromEntries(keys.map((key) => [key, {
    count: key === 'expensesLast30DaysUsd' ? 0 : 1,
    maxDateOrUpdate: key === 'expensesLast30DaysUsd' ? '2025-12-09T12:00:00.000Z' : NOW.toISOString(),
    freshness: key === 'expensesLast30DaysUsd' ? 'STALE' : 'FRESH',
    coverage: key === 'expensesLast30DaysUsd' ? 'UNKNOWN' : 'COMPLETE',
    currency: key === 'expensesLast30DaysUsd' ? 'UNKNOWN' : 'COUNT',
    confidence: key === 'expensesLast30DaysUsd' ? 'LOW' : 'HIGH',
  }])) as CompanySnapshot['quality']['metrics'];
  const snapshot = {
    snapshotId: 'quality-zero',
    generatedAt: NOW.toISOString(),
    businessDate: '2026-08-15',
    timeZone: 'America/New_York',
    source: 'ESWCARGO_PRODUCTION_READ_ONLY',
    metrics: {
      ordersLast7Days: 1, revenueLast7DaysUsd: 100, ordersNonUsdLast7Days: 0, ordersToBuy: 0,
      productsActive: 1175, unitsInStock: 10, productsWithoutStockRaw: 1175,
      actionableProductsWithoutStock: 0, shipmentsInTransit: 0, delayedShipments: 0,
      purchasesPending: 0, purchasesBalanceUsd: 0, expensesLast30DaysUsd: 0,
    },
    distributions: { orderStatus: [], shipmentStatus: [] },
    calibration: { actionableProducts: [], delayedShipmentDossiers: [] },
    quality: { metrics: profiles, gaps: ['EXPENSE_COVERAGE_UNKNOWN', 'EXPENSE_CURRENCY_UNKNOWN', 'PRODUCT_AVAILABILITY_EMPTY_OR_STALE'] },
    freshness: {
      latestOrderUpdate: NOW.toISOString(),
      latestProductUpdate: NOW.toISOString(),
      latestShipmentUpdate: NOW.toISOString(),
      latestSync: { id: 1, status: 'SUCCESS', scope: 'DIRECT_OPERATIONAL', startedAt: NOW.toISOString(), finishedAt: NOW.toISOString(), ageHours: 0, fresh: true },
    },
  } satisfies CompanySnapshot;
  const brief = buildDeterministicFallback(snapshot, 'test');
  assert.ok(brief.dataQuality.gaps.includes('EXPENSE_COVERAGE_UNKNOWN'));
  assert.ok(brief.priorities.some((priority) => priority.id === 'DATA-EXPENSE-COVERAGE'));
  assert.ok(brief.priorities.some((priority) => priority.id === 'DATA-PRODUCT-CALIBRATION'));
  assert.equal(brief.priorities.some((priority) => priority.id === 'STOCK-GAPS'), false);
  assert.equal(brief.priorities.some((priority) => priority.evidence.some((evidence) => evidence.includes('1175 producto(s) sin stock'))), false);
});

test('cero crítico también abre gap con cobertura parcial, baja confianza o dato stale', () => {
  const base = {
    count: 0,
    maxDateOrUpdate: NOW.toISOString(),
    freshness: 'FRESH' as const,
    coverage: 'COMPLETE' as const,
    currency: 'COUNT' as const,
    confidence: 'HIGH' as const,
  };
  assert.equal(zeroNeedsQualityGap(0, base), false);
  assert.equal(zeroNeedsQualityGap(0, { ...base, coverage: 'PARTIAL' }), true);
  assert.equal(zeroNeedsQualityGap(0, { ...base, confidence: 'LOW' }), true);
  assert.equal(zeroNeedsQualityGap(0, { ...base, freshness: 'STALE' }), true);
  assert.equal(zeroNeedsQualityGap(0, { ...base, currency: 'UNKNOWN' }), true);
});

test('las vistas de calibración exponen señales sin PII y conservan business read-only', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20260816013314_company_os_v2_read_sources.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE OR REPLACE VIEW company_os_source\.recent_product_inquiries/);
  assert.match(sql, /CREATE OR REPLACE VIEW company_os_source\.supplier_availability/);
  assert.match(sql, /GRANT SELECT ON[\s\S]*TO company_os_reader/);
  assert.doesNotMatch(sql, /GRANT (INSERT|UPDATE|DELETE) ON\s+public\."(Order|Product|Purchase|Shipment|Expense)/);
  const inquiryView = sql.slice(sql.indexOf('CREATE OR REPLACE VIEW company_os_source.recent_product_inquiries'), sql.indexOf('CREATE OR REPLACE VIEW company_os_source.supplier_availability'));
  assert.doesNotMatch(inquiryView, /sender_phone|recipient_phone|external_chat_id|source_contact_name/);

  const hardening = readFileSync(new URL('../../supabase/migrations/20260816013901_company_os_v2_calibration_hardening.sql', import.meta.url), 'utf8');
  assert.match(hardening, /HAVING count\(DISTINCT product_id\) = 1/);
  assert.match(hardening, /supplier_sku/);
  assert.doesNotMatch(hardening, /sp\."supplierName"\) = ni\.normalized_item/);
  const snapshotSource = readFileSync(new URL('../lib/company-os/live-snapshot.ts', import.meta.url), 'utf8');
  assert.match(snapshotSource, /oi\."shipmentId" = s\.id OR \(o\.id IS NOT NULL AND oi\."orderId" = o\.id\)/);
});
