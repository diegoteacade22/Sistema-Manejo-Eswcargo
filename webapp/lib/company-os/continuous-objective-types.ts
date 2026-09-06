export const CONTINUOUS_OBJECTIVE_ALLOWED_PROJECTS = [
  'AGENTE MANAGER', 'SISTEMA ESWCARGO', 'AGENT OS', 'ESWCARGO', 'CRM ESWTECH',
  'CRM ESWTECH · WHATSAPP OPERATIVO', 'LISTAS Y DIFUSION PRECIOS', 'GOOGLE ADS ESWTECH',
  'PLANILLAS SHEETS MANEJO', 'COMPRAS ESW', 'COTIZADOR ENVIOS ESWTECH',
] as const;

export type ContinuousObjectiveStatus = 'ACTIVE' | 'PAUSED' | 'EXPIRED';
export type ObjectiveUnitStatus = 'PLANNED' | 'QUEUED' | 'ANALYZED' | 'VERIFIED' | 'NEEDS_REVIEW' | 'BLOCKED' | 'SKIPPED';
export type ContinuousObjectiveAgentId = 'general-manager-ai-v3' | 'systems-manager-ai-v1' | 'data-manager-ai-v1';
export type ObjectiveUnitSource = {
  kind: 'CODEX_METADATA' | 'SYSTEMS_BASELINE' | 'DATA_BASELINE';
  projectName: string;
  title: string;
  threadId?: string;
  category?: string;
  humanStatus?: string;
  sourceFingerprint?: string;
  nextAction?: string;
  reportedResult?: string;
  authority: 'UNTRUSTED_METADATA_ONLY' | 'LIVE_SNAPSHOT_REQUIRED';
  verificationScope: 'ANALYSIS_ONLY';
};
export type ContinuousObjectiveUnitView = {
  id: string; goalId: string; version: number; sourceId: string; fingerprint: string;
  caseId: string | null; status: ObjectiveUnitStatus; ownerAgentId: ContinuousObjectiveAgentId;
  priority: number; source: ObjectiveUnitSource; resultSummary: string | null;
  resultEvidence: string[]; sourceResolved: false; verificationScope: 'ANALYSIS_ONLY'; createdAt: string; updatedAt: string;
};
export type ContinuousObjectiveView = {
  id: string; version: number; controlRevision: number; title: string; objective: string; status: ContinuousObjectiveStatus;
  startsAt: string; endsAt: string; projectAllowlist: string[]; criteria: string[];
  scanIntervalMinutes: number; nextScanAt: string; createdBy: string; createdAt: string; updatedAt: string;
  lastScanAt: string | null; sourcesObserved: number; sourcesExcluded: number;
  counts: { planned: number; queued: number; analyzed: number; verified: number; needsReview: number; blocked: number; skipped: number };
  units: ContinuousObjectiveUnitView[];
};
export type CreateContinuousObjectiveInput = {
  title: string; objective: string; projectAllowlist: string[]; criteria: string[];
  durationDays?: number; endsAt?: string; scanIntervalMinutes?: number; idempotencyKey: string;
};
export type ControlContinuousObjectiveInput = {
  objectiveId: string; action: 'PAUSE' | 'RESUME'; expectedVersion: number; expectedControlRevision: number; idempotencyKey: string;
};
export type ContinuousObjectiveIdentity = string;
export type PendingContinuousObjectiveUnit = ContinuousObjectiveUnitView & {
  unitId: string; objective: string; criteria: string[]; goalTitle: string;
};

export class ContinuousObjectiveError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'INVALID_CONTINUOUS_OBJECTIVE') {
    super(message);
    this.name = 'ContinuousObjectiveError';
  }
}
