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
    productsWithoutStock: number;
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
};

export const COMPANY_OS_EVIDENCE_KEYS = [
  'ordersLast7Days',
  'revenueLast7DaysUsd',
  'ordersNonUsdLast7Days',
  'ordersToBuy',
  'productsActive',
  'unitsInStock',
  'productsWithoutStock',
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
  schemaVersion: '1';
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
  executiveSummary: string;
  priorities: Array<Omit<CompanyPriority, 'evidence'> & { evidenceRefs: CompanyEvidenceKey[] }>;
  delegations: CompanyDelegation[];
  dataQuality: { gaps: string[] };
};
