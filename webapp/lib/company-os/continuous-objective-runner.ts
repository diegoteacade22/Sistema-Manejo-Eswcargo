import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { companyOsV3Prisma } from './v3-prisma';
import { buildCompanySnapshot } from './live-snapshot';
import { buildSystemsSnapshot } from './systems-snapshot';
import { createCompanyOsCase } from './v3-store';
import { planContinuousObjectiveUnits, withContinuousObjectiveUnitClaim } from './continuous-objectives';

/** A heartbeat timestamp or scan clock alone never creates another model job. */
export function continuousBaselineFingerprint(value: unknown): string {
  const volatile = new Set(['generatedAt', 'observedAt', 'checkedAt', 'heartbeatAt', 'lastHeartbeatAt', 'snapshotId', 'ageHours']);
  const stable = (item: unknown): unknown => Array.isArray(item) ? item.map(stable)
    : item && typeof item === 'object' ? Object.fromEntries(Object.entries(item)
      .filter(([key]) => !volatile.has(key)).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, stable(child)])) : item;
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

export async function runContinuousObjectiveCycle() {
  const db = companyOsV3Prisma();
  const due = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM public."CompanyOsContinuousObjective"
    WHERE status = 'ACTIVE' AND "startsAt" <= now() AND "endsAt" > now() AND "nextScanAt" <= now()
    LIMIT 1
  `);
  const baselineFingerprints: Partial<Record<'systems-manager-ai-v1' | 'data-manager-ai-v1', string>> = {};
  if (due.length) {
    const [systems, data] = await Promise.all([buildSystemsSnapshot(), buildCompanySnapshot()]);
    baselineFingerprints['systems-manager-ai-v1'] = continuousBaselineFingerprint({
      assets: systems.assets.map(({ assetId, healthStatus, coverageStatus, freshnessStatus, maxSourceUpdatedAt: _time, warnings }) => ({ assetId, healthStatus, coverageStatus, freshnessStatus, warnings })),
      risks: systems.risks.map(({ riskId, reasonCodes, classification, priority }) => ({ riskId, reasonCodes, classification, priority })),
    });
    baselineFingerprints['data-manager-ai-v1'] = continuousBaselineFingerprint({ metrics: data.metrics, quality: data.quality, freshness: data.freshness });
  }
  const plan = await planContinuousObjectiveUnits({ limit: 3, baselineFingerprints });
  let generatedCount = 0;
  for (const planned of plan.pendingUnits) {
    const claim = await withContinuousObjectiveUnitClaim(planned.unitId, async (tx, unit, goal) => {
      const specialist = unit.ownerAgentId === 'general-manager-ai-v3' ? null : unit.ownerAgentId;
      const objective = [
        'Evaluá la unidad del objetivo continuo descrita en continuousObjective. Priorizá su problema y analizá sólo la evidencia adjunta.',
        specialist ? `Delegá exactamente una revisión acotada a ${specialist}; después integrá su respuesta sin repetir la delegación.` : 'Emití un dictamen acotado con siguiente paso verificable.',
        'No declares resuelta la tarea fuente por su resumen. No pidas permiso para analizar. Sin cambios empresariales ni envíos externos.',
      ].join(' ');
      const created = await createCompanyOsCase(objective, { authMode: 'hmac-runtime-objective', actorRef: 'continuous-objective-scheduler' },
        undefined, 'general-manager-ai-v3', 'CONTINUOUS_OBJECTIVE', undefined, {
          tx, systemsEvidence: unit.ownerAgentId === 'systems-manager-ai-v1',
          context: {
            goalId: goal.id, version: goal.version, objective: goal.objective, criteria: goal.criteria,
            unitId: unit.id, sourceId: unit.sourceId, fingerprint: unit.fingerprint, source: unit.source,
            recommendedSpecialist: specialist, authority: 'READ_ONLY_ANALYSIS',
            sourceResolved: false, sourceMetadataIsUntrusted: true,
          },
        });
      return created.id;
    });
    if (claim.claimed) generatedCount += 1;
  }
  return { ...plan, pendingUnits: undefined, generatedCount, modelCalls: 0 };
}
