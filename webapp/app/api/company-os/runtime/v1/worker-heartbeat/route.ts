import { NextResponse } from 'next/server';
import { recordCompanyOsWorkerHeartbeat } from '@/lib/company-os/runtime-store';
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
  const dependencies = Array.isArray(verified.input.dependencies)
    ? verified.input.dependencies.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item))).map((item) => ({
      key: String(item.key ?? ''), status: String(item.status ?? ''),
      observedAt: typeof item.observedAt === 'string' ? item.observedAt : undefined,
      latencyMs: item.latencyMs == null ? null : Number(item.latencyMs),
      detail: typeof item.detail === 'string' ? item.detail : null,
      caseId: typeof item.caseId === 'string' ? item.caseId : null,
    })) : [];
  try {
    const result = await recordCompanyOsWorkerHeartbeat({
      workerId, instanceId, host, version, state, startedAt,
      currentWork: Array.isArray(verified.input.currentWork) ? verified.input.currentWork : [],
      capacity: Number(verified.input.capacity ?? 2),
      allowedAgentIds: Array.isArray(verified.input.allowedAgentIds)
        ? verified.input.allowedAgentIds.filter((item): item is string => typeof item === 'string') : [],
      lastErrorCode: typeof verified.input.lastErrorCode === 'string' ? verified.input.lastErrorCode : null,
      dependencies,
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Heartbeat rechazado' }, { status: 409 });
  }
}
