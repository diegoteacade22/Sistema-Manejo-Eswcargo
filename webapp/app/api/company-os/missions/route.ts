import { NextResponse } from 'next/server';
import { hasTrustedHumanRequestOrigin, requireHumanCompanyAdmin } from '@/lib/company-os/human-admin';
import {
  listProjectedMissions,
  MissionDecisionError,
  recordHumanMissionDecision,
  type MissionDecisionInput,
} from '@/lib/company-os/mission-events';

export const dynamic = 'force-dynamic';

function errorResponse(error: unknown) {
  if (error instanceof MissionDecisionError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  console.error('[Company OS] Mission decision failed', {
    message: error instanceof Error ? error.message : 'unknown',
  });
  return NextResponse.json(
    { error: 'No se pudo verificar la decisión humana', code: 'MISSION_DECISION_FAILED' },
    { status: 500 },
  );
}

export async function GET(request: Request) {
  const authorization = await requireHumanCompanyAdmin(request);
  if (!authorization.ok) {
    return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  }

  const runId = new URL(request.url).searchParams.get('runId') ?? '';
  try {
    const result = await listProjectedMissions(runId);
    return NextResponse.json({
      ...result,
      mode: 'human_control_plane_only',
      effects: { businessWrites: 0, externalActions: 0 },
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const authorization = await requireHumanCompanyAdmin(request);
  if (!authorization.ok) {
    return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  }
  if (!hasTrustedHumanRequestOrigin(request)) {
    return NextResponse.json({ error: 'Origen no permitido', code: 'ORIGIN_FORBIDDEN' }, { status: 403 });
  }
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ error: 'Content-Type debe ser application/json', code: 'INVALID_CONTENT_TYPE' }, { status: 415 });
  }

  let input: MissionDecisionInput;
  try {
    input = await request.json() as MissionDecisionInput;
  } catch {
    return NextResponse.json({ error: 'JSON inválido', code: 'INVALID_JSON' }, { status: 400 });
  }

  try {
    const result = await recordHumanMissionDecision(input, authorization.identity);
    return NextResponse.json({
      ...result,
      mode: 'human_control_plane_only',
      effects: { businessWrites: 0, externalActions: 0 },
    }, {
      status: result.reused ? 200 : 201,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
