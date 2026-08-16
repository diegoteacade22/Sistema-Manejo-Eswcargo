import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { buildCompanySnapshot } from '@/lib/company-os/live-snapshot';
import {
  buildDeterministicFallback,
  companyOsModel,
  companyOsPolicyFingerprint,
  generateGeneralManagerBrief,
} from '@/lib/company-os/general-manager';
import { hasValidCompanyAgentKey } from '@/lib/company-os/auth';
import { sanitizeCompanyObjective } from '@/lib/company-os/objective';
import {
  companyActorRef,
  companyAgentRequestKey,
  executeCompanyAgentCycle,
  listCompanyAgentRuns,
} from '@/lib/company-os/run-store';
import type { CompanyBrief } from '@/lib/company-os/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

type CompanyIdentity = {
  authMode: 'company-os-key' | 'admin-session';
  actorRef: string;
};

async function requireAdmin(request: Request): Promise<CompanyIdentity | null> {
  if (hasValidCompanyAgentKey(request)) {
    return {
      authMode: 'company-os-key',
      actorRef: companyActorRef('company-os-key', 'company-os-api-key-v1'),
    };
  }

  const session = await auth();
  const sessionUser = session?.user as { id?: string; role?: string } | undefined;
  if (!sessionUser?.id || sessionUser.role !== 'ADMIN') return null;
  const currentUser = await prisma.user.findUnique({ where: { id: sessionUser.id }, select: { role: true } });
  if (currentUser?.role !== 'ADMIN') return null;

  return {
    authMode: 'admin-session',
    actorRef: companyActorRef('admin-session', sessionUser.id),
  };
}

function withAuditRun(brief: CompanyBrief, auditRunId: string, warnings: string[] = []) {
  return {
    ...brief,
    execution: { ...brief.execution, auditRunId },
    warnings: [...brief.warnings, ...warnings],
  } satisfies CompanyBrief;
}

export async function GET(request: Request) {
  const identity = await requireAdmin(request);
  if (!identity) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const historyRequested = new URL(request.url).searchParams.get('history') === '1';
  const runs = historyRequested ? await listCompanyAgentRuns() : [];

  return NextResponse.json({
    agent: 'Gerente General AI',
    version: '2',
    mode: 'business_data_read_only_with_append_only_audit',
    modelConfigured: Boolean((process.env.OPENAI_API_KEY ?? '').trim()),
    sourceConfigured: Boolean((process.env.COMPANY_OS_DATABASE_URL ?? '').trim()),
    authConfigured: Boolean((process.env.COMPANY_OS_API_KEY ?? '').trim()),
    authMode: identity.authMode,
    effects: { businessWrites: 0, auditWrites: 'one CompanyAgentRun plus planned missions per new cycle' },
    retention: { classification: 'internal-operational', reviewAfterDays: 365, enforcement: 'manual-review' },
    runs,
  });
}

export async function POST(request: Request) {
  const identity = await requireAdmin(request);
  if (!identity) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(process.env.COMPANY_OS_DATABASE_URL ?? '').trim()) {
    return NextResponse.json({ error: 'COMPANY_OS_DATABASE_URL no configurada' }, { status: 503 });
  }

  let rawObjective = '';
  try {
    const body = await request.json();
    if (body?.objective != null && typeof body.objective !== 'string') {
      return NextResponse.json({ error: 'objective debe ser texto' }, { status: 400 });
    }
    rawObjective = String(body?.objective ?? '').trim();
    if (rawObjective.length > 1200) {
      return NextResponse.json({ error: 'objective supera 1200 caracteres' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  try {
    const objective = sanitizeCompanyObjective(rawObjective);
    const snapshot = await buildCompanySnapshot();
    const model = companyOsModel();
    const canonicalRequestKey = companyAgentRequestKey(
      snapshot.snapshotId,
      objective.objectiveHash,
      model,
      companyOsPolicyFingerprint(),
    );

    const cycle = await executeCompanyAgentCycle({
      canonicalRequestKey,
      objectiveHash: objective.objectiveHash,
      snapshot,
      authMode: identity.authMode,
      actorRef: identity.actorRef,
      generate: async () => {
        try {
          const brief = await generateGeneralManagerBrief(snapshot, objective.safeObjective);
          return { brief, responseStatus: brief.execution.provider === 'openai' ? 200 : 207 };
        } catch (error) {
          const warning = error instanceof Error ? error.message : 'Fallo no identificado del modelo AI';
          console.error('[Company OS] OpenAI synthesis failed', { snapshotId: snapshot.snapshotId, warning });
          return { brief: buildDeterministicFallback(snapshot, warning), responseStatus: 207 };
        }
      },
    });

    const privacyWarnings = objective.redactions > 0
      ? [`Se ocultaron ${objective.redactions} dato(s) sensible(s) del objetivo antes de procesarlo.`]
      : [];
    const responseBrief = withAuditRun(cycle.brief, cycle.runId, privacyWarnings);
    return NextResponse.json(responseBrief, {
      status: cycle.responseStatus,
      headers: {
        'Cache-Control': 'no-store',
        'X-Company-OS-Snapshot': snapshot.snapshotId,
        'X-Company-OS-Run': cycle.runId,
        'X-Company-OS-Reused': String(cycle.reused),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const rateLimited = message.includes('Límite de 10 ciclos');
    const inProgress = message.includes('Ciclo equivalente en progreso');
    console.error('[Company OS] Run failed', { rateLimited, inProgress, message });
    return NextResponse.json(
      { error: rateLimited || inProgress ? message : 'No se pudo completar y verificar el ciclo del agente' },
      { status: rateLimited ? 429 : inProgress ? 409 : 503 },
    );
  }
}
