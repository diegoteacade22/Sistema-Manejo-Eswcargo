import { createHash } from 'node:crypto';
import { sanitizeCompanyText } from './objective';
import {
  CONTINUOUS_OBJECTIVE_ALLOWED_PROJECTS, ContinuousObjectiveError,
  type ContinuousObjectiveAgentId, type CreateContinuousObjectiveInput,
  type ObjectiveUnitSource, type ObjectiveUnitStatus,
} from './continuous-objective-types';

export const OBJECTIVE_SETTLED_CASE_STATUSES = ['COMPLETED', 'CANCELLED', 'FAILED_FINAL', 'NEEDS_REVIEW', 'AWAITING_REVIEW', 'BLOCKED'] as const;
export function objectiveCaseInFlight(input: { unitStatus: ObjectiveUnitStatus; caseStatus: string | null; hasPendingWork: boolean }) {
  return input.unitStatus === 'QUEUED' || input.hasPendingWork
    || (input.caseStatus !== null && !(OBJECTIVE_SETTLED_CASE_STATUSES as readonly string[]).includes(input.caseStatus));
}

export function objectiveHash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function safeObjectiveMetadata(value: unknown, max = 800) {
  return sanitizeCompanyText(typeof value === 'string' ? value : '', max).safeText
    .replace(/https?:\/\/\S+/gi, '[URL_REDACTED]')
    .replace(/\/(?:Users|home|private|tmp)\/[^\s]+/g, '[PATH_REDACTED]')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim();
}

export function validateContinuousObjectiveInput(input: CreateContinuousObjectiveInput, now = new Date()) {
  const text = (value: unknown, min: number, max: number) => {
    if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) {
      throw new ContinuousObjectiveError('Texto fuera de los límites permitidos');
    }
    const safe = safeObjectiveMetadata(value.trim(), max);
    if (safe.length < min) throw new ContinuousObjectiveError('El texto no contiene un objetivo válido');
    return safe;
  };
  if (!input || !Array.isArray(input.projectAllowlist) || input.projectAllowlist.length < 1 || input.projectAllowlist.length > 20
    || input.projectAllowlist.some((project) => !(CONTINUOUS_OBJECTIVE_ALLOWED_PROJECTS as readonly string[]).includes(project))) {
    throw new ContinuousObjectiveError('Seleccioná sólo proyectos empresariales habilitados');
  }
  if (!Array.isArray(input.criteria) || input.criteria.length < 1 || input.criteria.length > 12) {
    throw new ContinuousObjectiveError('Indicá entre 1 y 12 criterios verificables');
  }
  const interval = input.scanIntervalMinutes ?? 15;
  if (!Number.isInteger(interval) || interval < 15 || interval > 1440) {
    throw new ContinuousObjectiveError('El intervalo debe estar entre 15 y 1440 minutos');
  }
  const duration = input.durationDays ?? (input.endsAt ? null : 30);
  if (duration !== null && (!Number.isInteger(duration) || duration < 1 || duration > 30)) {
    throw new ContinuousObjectiveError('La duración debe estar entre 1 y 30 días');
  }
  const endsAt = duration === null ? new Date(input.endsAt!) : new Date(now.getTime() + duration * 86_400_000);
  if (!Number.isFinite(endsAt.getTime()) || endsAt <= now || endsAt.getTime() - now.getTime() > 30 * 86_400_000) {
    throw new ContinuousObjectiveError('El vencimiento debe ser futuro y de hasta 30 días');
  }
  const normalized = {
    title: text(input.title, 3, 160), objective: text(input.objective, 10, 4000),
    projectAllowlist: [...new Set(input.projectAllowlist)].sort(),
    criteria: input.criteria.map((criterion) => text(criterion, 3, 500)), scanIntervalMinutes: interval,
    durationDays: duration, endsAt: duration === null ? endsAt.toISOString() : undefined,
  };
  return { ...normalized, startsAt: now, endDate: endsAt, requestHash: objectiveHash(normalized) };
}

export type ObjectiveSourceCandidate = {
  id: string; threadId: string; title: string; projectName: string; category: string;
  humanStatus: string; sourceStatus: string; archived: boolean; priority: number;
  nextAction: string; resultSummary: string | null; fingerprint: string; attentionReason: string | null;
  boardStatus?: string | null; boardLifecycle?: string | null; projectNameOverride?: string | null;
};

export function planObjectiveSource(candidate: ObjectiveSourceCandidate, projects: readonly string[]) {
  const effectiveProject = candidate.projectNameOverride ?? candidate.projectName;
  const disallowedState = ['IN_PROGRESS', 'NEEDS_DIEGO', 'BLOCKED', 'DONE', 'DISCARDED', 'MONITORING'];
  if (!projects.includes(candidate.projectName) || !projects.includes(effectiveProject)) return { excluded: 'PROJECT_OUT_OF_SCOPE' } as const;
  if (candidate.category === 'PERSONAL') return { excluded: 'PERSONAL' } as const;
  if (candidate.archived || ['ARCHIVED', 'CLOSED'].includes(candidate.boardLifecycle ?? '')) return { excluded: 'CLOSED' } as const;
  if (!['IDLE', 'NOT_LOADED'].includes(candidate.sourceStatus)) return { excluded: 'ACTIVE_OR_UNOBSERVED' } as const;
  if (candidate.attentionReason || disallowedState.includes(candidate.humanStatus) || disallowedState.includes(candidate.boardStatus ?? '')) {
    return { excluded: 'REQUIRES_DECISION_OR_NOT_PENDING' } as const;
  }
  const humanStatus = candidate.boardStatus ?? candidate.humanStatus;
  if (!['UNREVIEWED', 'PENDING', 'READY_REVIEW'].includes(humanStatus)) return { excluded: 'NOT_PENDING' } as const;
  // These are pointers and reported metadata, never an instruction or proof of completion.
  const source: ObjectiveUnitSource = {
    kind: 'CODEX_METADATA', projectName: effectiveProject, threadId: candidate.threadId,
    title: safeObjectiveMetadata(candidate.title, 240), category: candidate.category, humanStatus,
    sourceFingerprint: /^[a-f0-9]{64}$/i.test(candidate.fingerprint) ? candidate.fingerprint : undefined,
    nextAction: safeObjectiveMetadata(candidate.nextAction), reportedResult: safeObjectiveMetadata(candidate.resultSummary),
    authority: 'UNTRUSTED_METADATA_ONLY', verificationScope: 'ANALYSIS_ONLY',
  };
  const domain = `${candidate.category} ${source.title}`;
  const ownerAgentId: ContinuousObjectiveAgentId = /\b(SYSTEMS|infraestructura|deploy|worker|servidor|runtime|github|vercel)\b/i.test(domain)
    ? 'systems-manager-ai-v1'
    : /\b(datos|data|calidad|ingesta|normaliza|inventario|stock|sheet|planilla)\b/i.test(domain)
      ? 'data-manager-ai-v1' : 'general-manager-ai-v3';
  // The collector fingerprint includes timestamps. Deliberately hash only meaningful, sanitized metadata.
  const { sourceFingerprint: _ignored, ...facts } = source;
  return { sourceId: `codex:${candidate.id}`, fingerprint: objectiveHash(facts), source, ownerAgentId,
    priority: Math.max(2, Math.min(5, Number(candidate.priority) || 3)) };
}

export function baselineObjectiveUnits(goal: { objective: string; criteria: string[]; projectAllowlist: string[] }, domains: readonly string[], facts: Partial<Record<ContinuousObjectiveAgentId, string>> = {}) {
  return (['systems-manager-ai-v1', 'data-manager-ai-v1'] as const).filter((agent) => !domains.includes(agent)).map((ownerAgentId) => {
    const systems = ownerAgentId === 'systems-manager-ai-v1';
    const source: ObjectiveUnitSource = {
      kind: systems ? 'SYSTEMS_BASELINE' : 'DATA_BASELINE', projectName: goal.projectAllowlist.join(' · '),
      title: systems ? 'Verificar snapshot técnico vivo y cobertura operativa' : 'Verificar snapshot empresarial vivo, calidad y frescura de datos',
      authority: 'LIVE_SNAPSHOT_REQUIRED', verificationScope: 'ANALYSIS_ONLY',
    };
    return { sourceId: systems ? 'baseline:systems' : 'baseline:data', ownerAgentId,
      priority: systems ? 0 : 1, source, fingerprint: objectiveHash({ source, objective: goal.objective, criteria: goal.criteria,
        facts: facts[ownerAgentId] ?? 'INITIAL_SNAPSHOT_REQUIRED' }) };
  });
}

export function observeObjectiveUnit(input: {
  caseStatus: string; hasPendingWork: boolean; resultMessageId: string | null;
  confidence: number | null; needsHumanDecision: boolean | null;
  evidenceIds: string[]; resultSummary: string | null; sourceKind?: ObjectiveUnitSource['kind'];
}): { status: ObjectiveUnitStatus; resultSummary: string; resultEvidence: string[] } | null {
  if (input.hasPendingWork) return null;
  if (['FAILED_FINAL', 'BLOCKED'].includes(input.caseStatus)) {
    return { status: 'BLOCKED', resultSummary: 'El caso quedó bloqueado; no se certificó el resultado.', resultEvidence: [] };
  }
  if (input.caseStatus === 'CANCELLED') return { status: 'SKIPPED', resultSummary: 'Caso cancelado; no se ejecutó ni verificó la tarea fuente.', resultEvidence: [] };
  if (!['COMPLETED', 'NEEDS_REVIEW', 'AWAITING_REVIEW'].includes(input.caseStatus)) return null;
  const completed = input.caseStatus === 'COMPLETED' && input.resultMessageId
    && input.confidence !== null && input.confidence >= 0.75 && input.needsHumanDecision === false;
  const verified = completed && input.sourceKind !== 'CODEX_METADATA' && input.evidenceIds.length > 0;
  return {
    status: verified ? 'VERIFIED' : completed ? 'ANALYZED' : 'NEEDS_REVIEW',
    resultSummary: `${verified ? 'Análisis con evidencia de snapshot' : completed ? 'Análisis de metadata concluido' : 'Análisis requiere revisión'}. No certifica la ejecución de la tarea fuente. ${safeObjectiveMetadata(input.resultSummary, 1200)}`.trim(),
    resultEvidence: [...(input.resultMessageId ? [`message:${input.resultMessageId}`] : []), ...input.evidenceIds.map((id) => `evidence:${id}`)],
  };
}
