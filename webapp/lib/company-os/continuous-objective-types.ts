export const CONTINUOUS_OBJECTIVE_ALLOWED_PROJECTS = [
  'AGENTE MANAGER', 'SISTEMA ESWCARGO', 'AGENT OS', 'ESWCARGO', 'CRM ESWTECH',
  'CRM ESWTECH · WHATSAPP OPERATIVO', 'LISTAS Y DIFUSION PRECIOS', 'GOOGLE ADS ESWTECH',
  'PLANILLAS SHEETS MANEJO', 'COMPRAS ESW', 'COTIZADOR ENVIOS ESWTECH',
] as const;

export const CONTINUOUS_OBJECTIVE_EXTERNAL_SOURCES = [
  { id: 'GOOGLE_DRIVE', label: 'Google Drive', status: 'BLOCKED_REQUIRES_RUNTIME_CONNECTOR', note: 'La conexión existe en la sesión de trabajo, pero todavía no está disponible para el runtime independiente.' },
  { id: 'GOOGLE_SHEETS', label: 'Google Sheets', status: 'BLOCKED_REQUIRES_RUNTIME_CONNECTOR', note: 'Requiere OAuth de sólo lectura instalado en el runtime de Company OS.' },
  { id: 'GOOGLE_CONTACTS', label: 'Contactos Google', status: 'BLOCKED_REQUIRES_RUNTIME_CONNECTOR', note: 'Requiere OAuth de sólo lectura instalado en el runtime de Company OS.' },
  { id: 'CHATGPT_WORK', label: 'ChatGPT Work', status: 'BLOCKED_REQUIRES_READONLY_BRIDGE', note: 'No hay un puente autorizado que entregue contenido de hilos al runtime; queda preparado como integración read-only.' },
] as const;

export type ContinuousObjectiveExternalSourceId = typeof CONTINUOUS_OBJECTIVE_EXTERNAL_SOURCES[number]['id'];
export type ContinuousObjectiveExternalSourceStatus = typeof CONTINUOUS_OBJECTIVE_EXTERNAL_SOURCES[number]['status'];

export type ContinuousObjectiveStatus = 'ACTIVE' | 'PAUSED' | 'EXPIRED';
export type ObjectiveUnitStatus = 'PLANNED' | 'QUEUED' | 'ANALYZED' | 'VERIFIED' | 'NEEDS_REVIEW' | 'BLOCKED' | 'SKIPPED';
export type ContinuousObjectiveAgentId = 'general-manager-ai-v3' | 'systems-manager-ai-v1' | 'data-manager-ai-v1';
export type ObjectiveUnitSource = {
  kind: 'CODEX_METADATA' | 'SYSTEMS_BASELINE' | 'DATA_BASELINE' | 'EXTERNAL_SOURCE_BLOCKED' | 'EXTERNAL_SOURCE_LIVE';
  projectName: string;
  title: string;
  threadId?: string;
  category?: string;
  humanStatus?: string;
  sourceFingerprint?: string;
  nextAction?: string;
  reportedResult?: string;
  authority: 'UNTRUSTED_METADATA_ONLY' | 'LIVE_SNAPSHOT_REQUIRED' | 'CONNECTOR_REQUIRED';
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
  externalSources: ContinuousObjectiveExternalSourceId[];
  scanIntervalMinutes: number; nextScanAt: string; createdBy: string; createdAt: string; updatedAt: string;
  lastScanAt: string | null; sourcesObserved: number; sourcesExcluded: number;
  counts: { planned: number; queued: number; analyzed: number; verified: number; needsReview: number; blocked: number; skipped: number };
  units: ContinuousObjectiveUnitView[];
};
export type CreateContinuousObjectiveInput = {
  title: string; objective: string; projectAllowlist: string[]; externalSources?: ContinuousObjectiveExternalSourceId[]; criteria: string[];
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
