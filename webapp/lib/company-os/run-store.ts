import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { CompanyBrief, CompanySnapshot } from './types';

export function companyAgentRequestKey(
  snapshotId: string,
  objectiveHash: string,
  model: string,
  policyFingerprint: string,
) {
  return createHash('sha256')
    .update(JSON.stringify({ snapshotId, objectiveHash, model, policyFingerprint }))
    .digest('hex');
}

export function companyActorRef(authMode: string, actorId: string) {
  return createHash('sha256').update(`${authMode}:${actorId}`).digest('hex').slice(0, 20);
}

export async function enforceCompanyAgentRateLimit(actorRef: string, limit = 10) {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const count = await prisma.companyAgentRun.count({ where: { actorRef, createdAt: { gte: since } } });
  if (count >= limit) throw new Error('Límite de 10 ciclos por hora alcanzado');
}

type CycleResult = {
  brief: CompanyBrief;
  runId: string;
  reused: boolean;
  responseStatus: number;
};

export async function executeCompanyAgentCycle(input: {
  canonicalRequestKey: string;
  objectiveHash: string;
  snapshot: CompanySnapshot;
  authMode: string;
  actorRef: string;
  generate: () => Promise<{ brief: CompanyBrief; responseStatus: number }>;
}): Promise<CycleResult> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${input.canonicalRequestKey}))`;

    const existing = await tx.companyAgentRun.findUnique({
      where: { requestKey: input.canonicalRequestKey },
    });
    if (existing?.provider === 'openai') {
      return {
        brief: existing.brief as unknown as CompanyBrief,
        runId: existing.id,
        reused: true,
        responseStatus: 200,
      };
    }

    const generated = await input.generate();
    const requestKey = generated.brief.execution.provider === 'openai'
      ? input.canonicalRequestKey
      : `fallback:${input.canonicalRequestKey}:${randomUUID()}`;
    const run = await tx.companyAgentRun.create({
      data: {
        requestKey,
        businessDate: input.snapshot.businessDate,
        objectiveHash: input.objectiveHash,
        snapshotId: input.snapshot.snapshotId,
        provider: generated.brief.execution.provider,
        model: generated.brief.execution.model,
        responseId: generated.brief.execution.responseId,
        status: generated.brief.status,
        authMode: input.authMode,
        actorRef: input.actorRef,
        snapshot: input.snapshot as unknown as Prisma.InputJsonValue,
        brief: generated.brief as unknown as Prisma.InputJsonValue,
        missions: {
          create: generated.brief.delegations.map((delegation) => ({
            agent: delegation.agent,
            mission: delegation.mission,
            why: delegation.why,
            expectedOutput: delegation.expectedOutput,
            status: 'QUEUED',
          })),
        },
      },
    });
    const readback = await tx.companyAgentRun.findUnique({
      where: { id: run.id },
      include: { missions: true },
    });
    if (!readback || readback.missions.length !== generated.brief.delegations.length) {
      throw new Error('Readback incompleto de CompanyAgentRun y sus misiones');
    }

    return {
      brief: generated.brief,
      runId: run.id,
      reused: false,
      responseStatus: generated.responseStatus,
    };
  }, { maxWait: 15_000, timeout: 150_000 });
}

export async function listCompanyAgentRuns(limit = 10) {
  return prisma.companyAgentRun.findMany({
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 25),
    select: {
      id: true,
      businessDate: true,
      objectiveHash: true,
      snapshotId: true,
      provider: true,
      model: true,
      responseId: true,
      status: true,
      authMode: true,
      actorRef: true,
      brief: true,
      createdAt: true,
      missions: {
        select: { id: true, agent: true, mission: true, expectedOutput: true, status: true, createdAt: true },
      },
    },
  });
}
