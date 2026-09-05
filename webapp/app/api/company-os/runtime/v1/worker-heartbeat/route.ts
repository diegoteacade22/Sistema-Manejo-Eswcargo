import { NextResponse } from 'next/server';
import { recordCompanyOsWorkerHeartbeat } from '@/lib/company-os/runtime-store';
import {
  ExternalSourceItemError,
  externalSourceDependencyKey,
  formatExternalSourceDependencyDetail,
  parseRuntimeExternalSourceBatches,
} from '@/lib/company-os/runtime-external-items';
import { requiredString, verifiedRuntimeJson } from '../_request';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const verified = await verifiedRuntimeJson(request);
  if ('error' in verified) return verified.error;
  const workerId = requiredString(verified.input, 'workerId');
  const instanceId = requiredString(verified.input, 'instanceId');
  const host = requiredString(verified.input, 'host');
  const version = requiredString(verified.input, 'version');
  const state = requiredString(verified.input, 'state');
  const startedAt = requiredString(verified.input, 'startedAt');
  if (!workerId || !instanceId || !host || !version || !state || !startedAt) {
    return NextResponse.json({ error: 'Heartbeat del worker incompleto' }, { status: 400 });
  }
  const baseDependencies = Array.isArray(verified.input.dependencies)
    ? verified.input.dependencies.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item))).map((item) => ({
      key: String(item.key ?? ''), status: String(item.status ?? ''),
      observedAt: typeof item.observedAt === 'string' ? item.observedAt : undefined,
      latencyMs: item.latencyMs == null ? null : Number(item.latencyMs),
      detail: typeof item.detail === 'string' ? item.detail : null,
      caseId: typeof item.caseId === 'string' ? item.caseId : null,
    })).filter((item) => !item.key.startsWith('external-')) : [];
  try {
    const externalSourceBatches = parseRuntimeExternalSourceBatches(verified.input.externalSources);
    const batchesBySource = new Map(externalSourceBatches.map((batch) => [batch.sourceId, batch]));
    const externalDependencies = Array.isArray(verified.input.externalSources)
      ? verified.input.externalSources.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
        .flatMap((item) => {
          const sourceId = typeof item.sourceId === 'string' ? item.sourceId : '';
          const batch = batchesBySource.get(sourceId as typeof externalSourceBatches[number]['sourceId']);
          if (item.status === 'HEALTHY' && batch) return [{
            key: externalSourceDependencyKey(batch.sourceId), status: 'HEALTHY', observedAt: batch.capturedAt,
            latencyMs: item.latencyMs == null ? null : Number(item.latencyMs), caseId: null,
            detail: formatExternalSourceDependencyDetail(batch),
          }];
          if (item.status === 'UNAVAILABLE' && /^(GOOGLE_DRIVE|GOOGLE_SHEETS|GOOGLE_CONTACTS|CHATGPT_WORK)$/.test(sourceId)) return [{
            key: `external-${sourceId.toLowerCase().replaceAll('_', '-')}`, status: 'UNAVAILABLE',
            observedAt: typeof item.observedAt === 'string' ? item.observedAt : undefined,
            latencyMs: item.latencyMs == null ? null : Number(item.latencyMs), caseId: null,
            detail: typeof item.detail === 'string' ? item.detail : 'read_only=true;code=UNAVAILABLE',
          }];
          return [];
        }) : [];
    const dependencies = [...baseDependencies, ...externalDependencies];
    const result = await recordCompanyOsWorkerHeartbeat({
      workerId, instanceId, host, version, state, startedAt,
      currentWork: Array.isArray(verified.input.currentWork) ? verified.input.currentWork : [],
      capacity: Number(verified.input.capacity ?? 2),
      allowedAgentIds: Array.isArray(verified.input.allowedAgentIds)
        ? verified.input.allowedAgentIds.filter((item): item is string => typeof item === 'string') : [],
      lastErrorCode: typeof verified.input.lastErrorCode === 'string' ? verified.input.lastErrorCode : null,
      dependencies,
      externalSourceBatches,
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Heartbeat rechazado',
      ...(error instanceof ExternalSourceItemError ? { code: error.code } : {}),
    }, { status: 409 });
  }
}
