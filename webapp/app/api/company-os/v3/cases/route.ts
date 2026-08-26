import { NextResponse } from 'next/server';
import { hasTrustedHumanRequestOrigin, requireHumanCompanyAdmin } from '@/lib/company-os/human-admin';
import { createCompanyOsCase, dispatchCompanyOsWebhook, listCompanyOsCases } from '@/lib/company-os/v3-store';
import { COMPANY_OS_AGENT_IDS, COMPANY_OS_V3_IDENTITY, type CompanyOsAgentId } from '@/lib/company-os/v3-types';
import { isCompanyOsRuntimeAgentInstalled } from '@/lib/company-os/runtime-store';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const authorization = await requireHumanCompanyAdmin(request);
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const agentRaw = new URL(request.url).searchParams.get('agentId');
  if (agentRaw && !COMPANY_OS_AGENT_IDS.includes(agentRaw as CompanyOsAgentId)) return NextResponse.json({ error: 'agentId inválido' }, { status: 400 });
  const agentId = agentRaw as CompanyOsAgentId | null;
  const cases = await listCompanyOsCases(Number(new URL(request.url).searchParams.get('limit') ?? 30), agentId ?? undefined);
  return NextResponse.json({ agent: agentId ?? 'all', agents: COMPANY_OS_AGENT_IDS, requestLifecycle: true, cases }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  const authorization = await requireHumanCompanyAdmin(request);
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  if (!hasTrustedHumanRequestOrigin(request)) return NextResponse.json({ error: 'Origen no permitido' }, { status: 403 });
  let input: { objective?: unknown; relatedRequestId?: unknown; agentId?: unknown; caseType?: unknown };
  try { input = await request.json(); } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }); }
  if (typeof input.objective !== 'string' || input.objective.trim().length > 600) {
    return NextResponse.json({ error: 'objective debe ser texto de hasta 600 caracteres' }, { status: 400 });
  }
  if (input.relatedRequestId != null && typeof input.relatedRequestId !== 'string') {
    return NextResponse.json({ error: 'relatedRequestId inválido' }, { status: 400 });
  }
  const agentId = input.agentId == null ? COMPANY_OS_V3_IDENTITY : String(input.agentId);
  if (!COMPANY_OS_AGENT_IDS.includes(agentId as CompanyOsAgentId)) return NextResponse.json({ error: 'agentId inválido' }, { status: 400 });
  if (!isCompanyOsRuntimeAgentInstalled(agentId)) return NextResponse.json({ error: `Agente ${agentId} NOT_INSTALLED` }, { status: 409 });
  const caseType = String(input.caseType ?? (
    agentId === 'systems-manager-ai-v1'
      ? 'TECHNICAL_ADVISORY'
      : 'ADVISORY'
  ));
  if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(caseType)) return NextResponse.json({ error: 'caseType inválido' }, { status: 400 });
  try {
    const companyCase = await createCompanyOsCase(input.objective, authorization.identity, input.relatedRequestId as string | undefined, agentId as CompanyOsAgentId, caseType);
    const delivery = companyCase.status === 'BLOCKED'
      ? { status: 'SKIPPED', responseCode: null, errorDetail: 'INPUT_BUDGET_BLOCKED' }
      : await dispatchCompanyOsWebhook(companyCase);
    return NextResponse.json({
      agent: companyCase.agentId,
      requestId: companyCase.requestId,
      caseId: companyCase.id,
      status: companyCase.status,
      delivery,
      recoveryGuaranteed: true,
      businessWrites: 0,
    }, { status: 202, headers: { 'Cache-Control': 'no-store', 'X-Company-OS-Request': companyCase.requestId } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo encolar el caso' }, { status: 503 });
  }
}
