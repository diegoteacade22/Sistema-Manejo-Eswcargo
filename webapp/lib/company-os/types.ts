export const COMPANY_OS_AREAS = [
  'GERENCIA_GENERAL',
  'DATA_QUALITY',
  'FINANZAS',
  'COMPRAS',
  'COMERCIAL',
  'LOGISTICA',
  'TECNOLOGIA',
] as const;

export type CompanyOsArea = (typeof COMPANY_OS_AREAS)[number];

export const COMPANY_OS_METRIC_KEYS = [
  'ordersLast7Days',
  'revenueLast7DaysUsd',
  'ordersNonUsdLast7Days',
  'ordersToBuy',
  'productsActive',
  'unitsInStock',
  'productsWithoutStockRaw',
  'actionableProductsWithoutStock',
  'shipmentsInTransit',
  'delayedShipments',
  'purchasesPending',
  'purchasesBalanceUsd',
  'expensesLast30DaysUsd',
] as const;

export type CompanyMetricKey = (typeof COMPANY_OS_METRIC_KEYS)[number];

export type MetricQualityProfile = {
  count: number;
  maxDateOrUpdate: string | null;
  freshness: 'FRESH' | 'STALE' | 'UNKNOWN';
  coverage: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN';
  currency: 'USD' | 'COUNT' | 'MIXED' | 'UNKNOWN';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
};

export type ActionableProduct = {
  productId: number;
  sku: string;
  pendingUnits: number;
  soldUnits90Days: number;
  soldOrders90Days: number;
  recentInquiryCount: number;
  grossMarginPct: number;
  availableUnits: number;
  supplierOfferAt: string;
};

export type DelayedShipmentDossier = {
  shipmentNumber: number;
  status: 'SALIENDO' | 'LLEGANDO';
  dateShipped: string;
  ageDays: number;
  updatedAt: string;
  linkedOrders: number;
  linkedItems: number;
  trackingReferences: number;
  classification: 'BLOCKED' | 'REVIEW';
  gaps: string[];
};

export type CompanySnapshot = {
  snapshotId: string;
  generatedAt: string;
  businessDate: string;
  timeZone: 'America/New_York';
  source: 'ESWCARGO_PRODUCTION_READ_ONLY';
  metrics: {
    ordersLast7Days: number;
    revenueLast7DaysUsd: number;
    ordersNonUsdLast7Days: number;
    ordersToBuy: number;
    productsActive: number;
    unitsInStock: number;
    productsWithoutStockRaw: number;
    actionableProductsWithoutStock: number;
    shipmentsInTransit: number;
    delayedShipments: number;
    purchasesPending: number;
    purchasesBalanceUsd: number;
    expensesLast30DaysUsd: number;
  };
  distributions: {
    orderStatus: Array<{ status: string; count: number }>;
    shipmentStatus: Array<{ status: string; count: number }>;
  };
  calibration: {
    actionableProducts: ActionableProduct[];
    delayedShipmentDossiers: DelayedShipmentDossier[];
  };
  quality: {
    metrics: Record<CompanyMetricKey, MetricQualityProfile>;
    gaps: string[];
  };
  freshness: {
    latestOrderUpdate: string | null;
    latestProductUpdate: string | null;
    latestShipmentUpdate: string | null;
    latestSync: {
      id: number;
      status: string;
      scope: string;
      startedAt: string;
      finishedAt: string | null;
      ageHours: number;
      fresh: boolean;
    } | null;
  };
};

export type CompanyPriority = {
  id: string;
  title: string;
  area: CompanyOsArea;
  urgency: 'P0' | 'P1' | 'P2';
  evidence: string[];
  recommendedAction: string;
  owner: string;
  dueWindow: string;
  requiresHumanApproval: boolean;
};

export type CompanyDelegation = {
  agent: Exclude<CompanyOsArea, 'GERENCIA_GENERAL'>;
  mission: string;
  why: string;
  expectedOutput: string;
  status: 'PLANNED';
};

export const COMPANY_OS_EVIDENCE_KEYS = [
  'ordersLast7Days',
  'revenueLast7DaysUsd',
  'ordersNonUsdLast7Days',
  'ordersToBuy',
  'productsActive',
  'unitsInStock',
  'actionableProductsWithoutStock',
  'shipmentsInTransit',
  'delayedShipments',
  'purchasesPending',
  'purchasesBalanceUsd',
  'expensesLast30DaysUsd',
  'latestOrderUpdate',
  'latestProductUpdate',
  'latestShipmentUpdate',
  'latestSync',
] as const;

export type CompanyEvidenceKey = (typeof COMPANY_OS_EVIDENCE_KEYS)[number];

export type CompanyBrief = {
  schemaVersion: '2';
  generatedAt: string;
  businessDate: string;
  status: 'READY' | 'NEEDS_ATTENTION' | 'BLOCKED';
  executiveSummary: string;
  priorities: CompanyPriority[];
  delegations: CompanyDelegation[];
  dataQuality: {
    cutoff: string;
    coverage: string[];
    gaps: string[];
    profiles: Record<CompanyMetricKey, MetricQualityProfile>;
  };
  guardrails: string[];
  execution: {
    provider: 'openai' | 'deterministic-fallback';
    model: string;
    responseId: string | null;
    snapshotId: string;
    businessDataReadOnly: true;
    auditWrite: 'CompanyAgentRun';
    auditRunId: string | null;
  };
  warnings: string[];
};

export type ModelBrief = {
  schemaVersion: '1';
  priorities: Array<{
    area: CompanyOsArea;
    urgency: 'P0' | 'P1' | 'P2';
    evidenceRefs: CompanyEvidenceKey[];
    actionType: 'REVIEW' | 'ANALYZE' | 'PREPARE_REPORT' | 'ESCALATE_FOR_HUMAN_DECISION';
    dueWindow: 'TODAY' | '24_HOURS' | '48_HOURS' | '7_DAYS';
  }>;
};
