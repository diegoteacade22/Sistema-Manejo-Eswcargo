import { NextResponse } from 'next/server';
import { hasTrustedHumanRequestOrigin, requireHumanCompanyAdmin } from '@/lib/company-os/human-admin';
import {
  ContinuousObjectiveError,
  listContinuousObjectives,
  createContinuousObjective,
  controlContinuousObjective,
} from '@/lib/company-os/continuous-objectives';
import { ContinuousObjectiveRequestError, parseContinuousObjectiveRequest, readContinuousObjectiveJson } from '@/lib/company-os/continuous-objectives-http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const noStore = { 'Cache-Control': 'no-store' };

function errorResponse(error: unknown) {
  if (error instanceof ContinuousObjectiveRequestError || error instanceof ContinuousObjectiveError) {
    return NextResponse.json({ error: error.message }, { status: error.status, headers: noStore });
  }
  return NextResponse.json({ error: 'No se pudo confirmar el estado del objetivo. Reintentá la misma operación.' }, { status: 503, headers: noStore });
}

export async function GET(request: Request) {
  // Browser GET fetches normally omit Origin, but include the browser-controlled Fetch Metadata header.
  const sameOriginRead = !request.headers.get('origin') && request.headers.get('sec-fetch-site') === 'same-origin';
  if (!sameOriginRead && !hasTrustedHumanRequestOrigin(request)) return NextResponse.json({ error: 'Origen no permitido.' }, { status: 403, headers: noStore });
  const authorization = await requireHumanCompanyAdmin(request);
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status, headers: noStore });
  try { return NextResponse.json(await listContinuousObjectives(), { headers: noStore }); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  if (!hasTrustedHumanRequestOrigin(request)) return NextResponse.json({ error: 'Origen no permitido.' }, { status: 403, headers: noStore });
  const authorization = await requireHumanCompanyAdmin(request);
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status, headers: noStore });
  try {
    const input = parseContinuousObjectiveRequest(await readContinuousObjectiveJson(request));
    const result = input.action === 'CREATE'
      ? await createContinuousObjective({ title: input.title, objective: input.objective, durationDays: input.durationDays,
        projectAllowlist: input.projectAllowlist, criteria: input.criteria, idempotencyKey: input.idempotencyKey }, authorization.identity.actorRef)
      : await controlContinuousObjective(input, authorization.identity.actorRef);
    return NextResponse.json(result, { status: input.action === 'CREATE' && !result.reused ? 201 : 200, headers: noStore });
  } catch (error) { return errorResponse(error); }
}
