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
  const leaseToken = randomUUID();
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + 4 * 60 * 1000);

  const reservation = await prisma.$transaction(async (tx) => {
    // Serializa el presupuesto por actor y luego el request canónico. Ambos
    // locks duran solo esta transacción corta; nunca abarcan la llamada OpenAI.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`company-os-rate:${input.actorRef}`}))`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`company-os-cycle:${input.canonicalRequestKey}`}))`;

    const existing = await tx.companyAgentRun.findUnique({ where: { requestKey: input.canonicalRequestKey } });
    if (existing?.provider === 'openai') {
      return { kind: 'reused' as const, run: existing };
    }

    const active = await tx.companyAgentRequest.findFirst({
      where: {
        requestKey: input.canonicalRequestKey,
        status: 'PENDING',
        leaseExpiresAt: { gt: now },
      },
      select: { id: true },
    });
    if (active) throw new Error('Ciclo equivalente en progreso');

    const since = new Date(now.getTime() - 60 * 60 * 1000);
    const attempts = await tx.companyAgentRequest.count({ where: { actorRef: input.actorRef, createdAt: { gte: since } } });
    if (attempts >= 10) throw new Error('Límite de 10 ciclos por hora alcanzado');

    const request = await tx.companyAgentRequest.create({
      data: {
        requestKey: input.canonicalRequestKey,
        actorRef: input.actorRef,
        status: 'PENDING',
        leaseToken,
        leaseExpiresAt,
      },
      select: { id: true },
    });
    return { kind: 'reserved' as const, requestId: request.id };
  }, { maxWait: 15_000, timeout: 15_000 });

  if (reservation.kind === 'reused') {
    return {
      brief: reservation.run.brief as unknown as CompanyBrief,
      runId: reservation.run.id,
      reused: true,
      responseStatus: 200,
    };
  }

  try {
    const generated = await input.generate();
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`company-os-cycle:${input.canonicalRequestKey}`}))`;
      const request = await tx.companyAgentRequest.findUnique({ where: { leaseToken } });
      if (!request || request.id !== reservation.requestId || request.status !== 'PENDING') {
        throw new Error('Reserva del ciclo inválida o vencida');
      }

      const existing = await tx.companyAgentRun.findUnique({ where: { requestKey: input.canonicalRequestKey } });
      if (existing?.provider === 'openai') {
        await tx.companyAgentRequest.update({
          where: { id: request.id },
          data: { status: 'REUSED', runId: existing.id },
        });
        return {
          brief: existing.brief as unknown as CompanyBrief,
          runId: existing.id,
          reused: true,
          responseStatus: 200,
        };
      }

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
              status: 'PLANNED',
            })),
          },
        },
      });
      const readback = await tx.companyAgentRun.findUnique({ where: { id: run.id }, include: { missions: true } });
      if (!readback || readback.missions.length !== generated.brief.delegations.length) {
        throw new Error('Readback incompleto de CompanyAgentRun y sus misiones');
      }
      await tx.companyAgentRequest.update({
        where: { id: request.id },
        data: { status: 'COMPLETED', runId: run.id },
      });

      return {
        brief: generated.brief,
        runId: run.id,
        reused: false,
        responseStatus: generated.responseStatus,
      };
    }, { maxWait: 15_000, timeout: 15_000 });
  } catch (error) {
    await prisma.companyAgentRequest.updateMany({
      where: { id: reservation.requestId, leaseToken, status: 'PENDING' },
      data: { status: 'FAILED' },
    }).catch(() => undefined);
    throw error;
  }
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
