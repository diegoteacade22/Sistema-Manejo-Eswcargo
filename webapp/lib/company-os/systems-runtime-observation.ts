export const SYSTEMS_RUNTIME_FRESH_MS = 150_000;
const AGENT_IDS = ['general-manager-ai-v3', 'systems-manager-ai-v1', 'data-manager-ai-v1'];

export type SystemsRuntimeWorkerRow = {
  workerId: string; host: string; state: string; version: string;
  allowedAgentIds: string[]; lastHeartbeatAt: Date | string; lastErrorCode: string | null;
};
export type SystemsRuntimeReadback = { observed: boolean; workers: SystemsRuntimeWorkerRow[] };

/** Only persisted heartbeats establish liveness; no URLs, credentials, or network probes. */
export function deriveSystemsRuntimeObservation(readback: SystemsRuntimeReadback, now: Date) {
  const timestamp = (value: Date | string) => new Date(value).getTime();
  const fresh = (row: SystemsRuntimeWorkerRow) => {
    const age = now.getTime() - timestamp(row.lastHeartbeatAt);
    return Number.isFinite(age) && age >= 0 && age <= SYSTEMS_RUNTIME_FRESH_MS;
  };
  const rows = readback.observed ? readback.workers
    .filter((row) => row.allowedAgentIds.includes('systems-manager-ai-v1'))
    .sort((a, b) => Number(fresh(b)) - Number(fresh(a)) || timestamp(b.lastHeartbeatAt) - timestamp(a.lastHeartbeatAt)) : [];
  const row = rows[0];
  const heartbeatTime = row ? timestamp(row.lastHeartbeatAt) : NaN;
  const heartbeatAt = Number.isFinite(heartbeatTime) ? new Date(heartbeatTime).toISOString() : null;
  const current = !!row && fresh(row);
  const host = row && /^[A-Za-z0-9._:-]{1,160}$/.test(row.host) ? row.host : null;
  const workerId = row && /^[A-Za-z0-9._:-]{1,160}$/.test(row.workerId) ? row.workerId : null;
  const allowedAgentIds = row ? AGENT_IDS.filter((id) => row.allowedAgentIds.includes(id)) : [];
  const missingAgentIds = AGENT_IDS.filter((id) => !allowedAgentIds.includes(id));
  const operational = current && ['IDLE', 'BUSY'].includes(row.state) && !row.lastErrorCode && missingAgentIds.length === 0;
  const healthStatus = !row ? 'UNOBSERVED' as const : !current ? 'UNKNOWN' as const : operational ? 'HEALTHY' as const : 'DEGRADED' as const;
  const freshHosts = new Set(rows.filter((item) => fresh(item) && ['IDLE', 'BUSY', 'DEGRADED'].includes(item.state)).map((item) => item.host));
  return {
    workerId, host, allowedAgentIds, missingAgentIds,
    state: current ? row.state : 'UNOBSERVED',
    heartbeatAt,
    healthStatus,
    coverageStatus: current ? (missingAgentIds.length ? 'PARTIAL' : 'CONFIRMED') : 'SOURCE_UNAVAILABLE',
    observationMode: current ? 'LIVE_OBSERVED' as const : 'UNOBSERVED' as const,
    observationLabel: current
      ? `Heartbeat persistido del runtime 24/7 ${workerId ?? 'sin identidad válida'} en ${host ?? 'host no observado'}; estado ${row.state}`
      : row ? 'Heartbeat del runtime 24/7 vencido o inválido; disponibilidad actual no observada'
        : 'Sin heartbeat observable del runtime 24/7',
    freshnessStatus: current ? 'CURRENT' as const : heartbeatAt ? 'STALE' as const : 'UNKNOWN' as const,
    safeReference: workerId ? `company-os-runtime:${workerId}` : null,
    warning: !readback.observed ? 'No se pudo leer el registro de workers; no implica OFFLINE'
      : !row ? 'No hay worker registrado con Systems en su allowlist; no implica OFFLINE'
      : !current ? 'Heartbeat vencido; no se afirma que el servidor esté apagado'
      : missingAgentIds.length ? `Agentes ausentes de la allowlist: ${missingAgentIds.join(', ')}`
      : !operational ? `Runtime reporta ${row.state}; revisar su telemetría de ejecución` : '',
    observedHostCount: freshHosts.size,
  };
}
