import { createHash, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { enqueueEngineeringMission, EngineeringStoreError } from '@/lib/company-os/engineering-store';
import { hasTrustedHumanRequestOrigin, requireHumanCompanyAdmin } from '@/lib/company-os/human-admin';

export const dynamic = 'force-dynamic';

const REPOSITORY = 'diegoteacade22/Sistema-Manejo-Eswcargo';
const POLICY_HASH = createHash('sha256').update('company-os-engineering-v2-live-probe-policy:v1').digest('hex');

async function currentMainCommit() {
  const deployed = process.env.VERCEL_GIT_COMMIT_SHA?.trim().toLowerCase();
  if (deployed && /^[a-f0-9]{40}$/.test(deployed)) return deployed;
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/commits/main`, {
    cache: 'no-store',
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'company-os-engineering-v2' },
  });
  if (!response.ok) throw new EngineeringStoreError('No se pudo observar main', 503, 'BASE_COMMIT_UNOBSERVED');
  const body = await response.json() as { sha?: unknown };
  const sha = typeof body.sha === 'string' ? body.sha.trim().toLowerCase() : '';
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new EngineeringStoreError('main sin SHA verificable', 503, 'BASE_COMMIT_UNOBSERVED');
  return sha;
}

export async function POST(request: Request) {
  const authorization = await requireHumanCompanyAdmin(request);
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  if (!hasTrustedHumanRequestOrigin(request)) return NextResponse.json({ error: 'Origen no permitido' }, { status: 403 });
  let input: unknown;
  try { input = await request.json(); } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }); }
  const level = input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>).autonomyLevel : null;
  if (level !== 'A1' && level !== 'A2') return NextResponse.json({ error: 'Prueba A1/A2 inválida' }, { status: 400 });
  try {
    const probeId = randomUUID();
    const allowedPath = `company-os/proofs/${level.toLowerCase()}-${probeId}.md`;
    const baseCommit = await currentMainCommit();
    return NextResponse.json(await enqueueEngineeringMission({
      repository: REPOSITORY,
      objective: `Create exactly ${allowedPath} with a concise production-safe Company OS ${level} live-proof receipt. Include the mission autonomy, UTC completion timestamp, and the statement: no business data, deploy, merge, secrets, or external messages were authorized. Do not change any other file.`,
      baseCommit,
      allowedPaths: [allowedPath],
      acceptanceCriteria: [
        `${allowedPath} exists and is the only changed path`,
        'The receipt states the autonomy level and prohibited production effects',
        'No secret-like material or symlink is present',
      ],
      autonomyLevel: level,
      budgetUsd: 1,
      deadline: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
      policyHash: POLICY_HASH,
      requestId: `engineering-live-probe:${level.toLowerCase()}:${probeId}`,
    }, authorization.identity.actorRef), { status: 202 });
  } catch (error) {
    const status = error instanceof EngineeringStoreError ? error.status : 409;
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Prueba rechazada' }, { status });
  }
}
