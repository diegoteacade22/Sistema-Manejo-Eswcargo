import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { companyOsV3Prisma } from './v3-prisma';
import type { CompanyOsWorkerUsage } from './v3-types';

type Tx = Prisma.TransactionClient;
export type RuntimeResultIdentity = {
  workItemId: string; requestId: string; leaseToken: string;
  workerId: string; instanceId: string; leaseInstanceId?: string; attemptId?: string;
};
export type RuntimeResultInput = RuntimeResultIdentity & { output: unknown; usage: CompanyOsWorkerUsage };

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => [k, canonical(v)]));
  return value;
}
export function runtimeResultHash(output: unknown) {
  return createHash('sha256').update(JSON.stringify(canonical(output))).digest('hex');
}
export class RuntimeResultSuperseded extends Error {}
export const resultReceiptKey = (attemptId: string) => `runtime-result:${attemptId}`;
export const resultArchiveKey = (attemptId: string) => `runtime-result-archived:${attemptId}`;

/** Historic ownership is required even for a terminal/idempotent readback. */
export async function authenticatedRuntimeResult(tx: Tx, input: RuntimeResultIdentity, lock = false) {
  if (lock) await tx.$queryRaw(Prisma.sql`SELECT id FROM public."CompanyOsWorkItem" WHERE id = ${input.workItemId} FOR UPDATE`);
  const lease = await tx.companyOsLease.findFirst({ where: {
    workItemId: input.workItemId, requestId: input.requestId, leaseToken: input.leaseToken,
    workerId: input.workerId, instanceId: input.leaseInstanceId ?? input.instanceId,
  } });
  if (!lease) throw new Error('Identidad del resultado incompatible con el lease');
  const attempt = await tx.companyOsExecutionAttempt.findFirst({ where: {
    ...(input.attemptId ? { id: input.attemptId } : {}),
    workItemId: input.workItemId, leaseToken: input.leaseToken,
    workerId: input.workerId, instanceId: lease.instanceId,
  } });
  if (!attempt) throw new Error('Intento del resultado inexistente');
  const work = await tx.companyOsWorkItem.findUniqueOrThrow({ where: { id: input.workItemId } });
  const companyCase = await tx.companyOsCase.findUniqueOrThrow({ where: { requestId: input.requestId } });
  if (companyCase.id !== work.caseId || lease.caseId !== work.caseId) throw new Error('Caso del resultado incompatible');
  return { lease, attempt, work, companyCase };
}

export async function readRuntimeResult(tx: Tx, input: RuntimeResultIdentity) {
  const identity = await authenticatedRuntimeResult(tx, input);
  const receipt = await tx.companyOsAuditEvent.findUnique({ where: { idempotencyKey: resultReceiptKey(identity.attempt.id) } });
  if (!receipt) return { state: 'NOT_FOUND' as const };
  const metadata = receipt.metadata as Record<string, Prisma.JsonValue>;
  const archived = await tx.companyOsAuditEvent.findUnique({ where: { idempotencyKey: resultArchiveKey(identity.attempt.id) } });
  if (metadata.state === 'SUPERSEDED' || archived) return {
    state: 'SUPERSEDED' as const, resultHash: String(metadata.resultHash), status: identity.work.status,
  };
  const message = await tx.companyOsMessage.findUnique({ where: {
    idempotencyKey: `runtime-message:${identity.work.id}:attempt:${metadata.workAttempt}:result`,
  } });
  const usage = await tx.companyOsUsage.findUnique({ where: { attemptId: identity.attempt.id } });
  const completed = identity.attempt.outcome === 'SUCCEEDED' && identity.work.status === 'COMPLETED'
    && identity.lease.status !== 'ACTIVE' && message?.caseId === identity.work.caseId && Boolean(usage);
  return { state: completed ? 'COMPLETED' as const : 'RECEIVED' as const,
    resultHash: String(metadata.resultHash), status: identity.companyCase.status };
}

export async function getCompanyOsRuntimeResultStatus(input: RuntimeResultIdentity) {
  return companyOsV3Prisma().$transaction((tx) => readRuntimeResult(tx, input), {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  });
}

/** Receipt commits separately from materialization: a failed apply cannot lose output. */
export async function receiveRuntimeResult(input: RuntimeResultInput, safeOutput: unknown) {
  return companyOsV3Prisma().$transaction(async (tx) => {
    const identity = await authenticatedRuntimeResult(tx, input, true);
    const resultHash = runtimeResultHash(input.output);
    const usageHash = runtimeResultHash(input.usage);
    const prior = await tx.companyOsAuditEvent.findUnique({ where: { idempotencyKey: resultReceiptKey(identity.attempt.id) } });
    if (prior) {
      const metadata = prior.metadata as Record<string, Prisma.JsonValue>;
      if (metadata.resultHash !== resultHash || metadata.usageHash !== usageHash) throw new Error('El intento ya recibió un resultado distinto');
      return { ...identity, state: String(metadata.state), resultHash };
    }
    const newerAttempt = await tx.companyOsExecutionAttempt.findFirst({ where: {
      workItemId: identity.work.id, attempt: { gt: identity.attempt.attempt },
    } });
    const superseded = Boolean(newerAttempt) || !['QUEUED', 'CLAIMED', 'RUNNING', 'FAILED_RETRYABLE', 'FAILED_FINAL'].includes(identity.companyCase.status)
      || ['COMPLETED', 'CANCELLED', 'BLOCKED', 'NEEDS_REVIEW', 'NEEDS_USER', 'BLOCKED_EXTERNAL'].includes(identity.work.status)
      || (identity.work.status === 'FAILED_FINAL' && identity.attempt.errorCode !== 'LEASE_EXPIRED');
    const state = superseded ? 'SUPERSEDED' : 'RECEIVED';
    await tx.companyOsAuditEvent.create({ data: {
      requestId: input.requestId, actorRef: input.workerId, action: 'RUNTIME_RESULT_RECEIVED',
      idempotencyKey: resultReceiptKey(identity.attempt.id),
      metadata: JSON.parse(JSON.stringify({ version: 1, workItemId: input.workItemId,
        attemptId: identity.attempt.id, workAttempt: identity.work.attemptCount, resultHash, usageHash,
        output: safeOutput, usage: input.usage, state, businessWrites: 0, infrastructureWrites: 0 })),
    } });
    return { ...identity, state, resultHash };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/** Only a durable receipt for the unchanged attempt permits late materialization. */
export async function requireRuntimeCompletionLease(tx: Tx, input: RuntimeResultInput, trustedReceiptReplay = false) {
  const identity = await authenticatedRuntimeResult(tx, input, true);
  const archived = await tx.companyOsAuditEvent.findUnique({ where: { idempotencyKey: resultArchiveKey(identity.attempt.id) } });
  if (archived) throw new RuntimeResultSuperseded('Resultado archivado; no puede materializarse nuevamente');
  const receipt = await tx.companyOsAuditEvent.findUnique({ where: { idempotencyKey: resultReceiptKey(identity.attempt.id) } });
  const metadata = receipt?.metadata as Record<string, Prisma.JsonValue> | undefined;
  if (!metadata || metadata.state !== 'RECEIVED' || (!trustedReceiptReplay && metadata.resultHash !== runtimeResultHash(input.output))
    || metadata.usageHash !== runtimeResultHash(input.usage)) throw new Error('Falta receipt durable compatible');
  // Work completion and case review are independent. An applied result remains
  // idempotent when the case awaits a human decision or was subsequently closed.
  if (identity.work.status === 'COMPLETED' && identity.attempt.outcome === 'SUCCEEDED'
    && (await readRuntimeResult(tx, input)).state === 'COMPLETED') return identity;
  const newer = await tx.companyOsExecutionAttempt.findFirst({ where: {
    workItemId: input.workItemId, attempt: { gt: identity.attempt.attempt },
  } });
  if (newer || !['QUEUED', 'CLAIMED', 'RUNNING', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'COMPLETED'].includes(identity.companyCase.status)
    || ['CANCELLED', 'BLOCKED', 'NEEDS_USER', 'BLOCKED_EXTERNAL'].includes(identity.work.status)) throw new RuntimeResultSuperseded('El intento fue reemplazado o cancelado');
  return identity;
}
