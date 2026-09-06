import { Prisma } from '@prisma/client';
import { companyOsV3Prisma } from '../lib/company-os/v3-prisma';

// Uses an already configured runtime role. Does not load secret files or inspect business tables.
const db = companyOsV3Prisma();
async function main() {
  const report = await db.$transaction(async (tx) => {
    const [work, attempts, leases, slots, usage, receiptCounts, strandedCases] = await Promise.all([
      tx.companyOsWorkItem.findMany({ orderBy: { updatedAt: 'desc' }, take: 100, select: {
        id: true, caseId: true, agentId: true, status: true, attemptCount: true, maxAttempts: true,
        availableAt: true, nextAttemptAt: true, completedAt: true, reservedTokens: true,
      } }),
      tx.companyOsExecutionAttempt.findMany({ orderBy: { startedAt: 'desc' }, take: 100, select: {
        id: true, workItemId: true, agentId: true, outcome: true, errorCode: true, startedAt: true, finishedAt: true, totalTokens: true,
      } }),
      tx.companyOsLease.findMany({ where: { status: 'ACTIVE' }, select: {
        id: true, workItemId: true, agentId: true, workerId: true, slotNo: true, expiresAt: true, reservedTokens: true,
      } }),
      tx.companyOsRuntimeSlot.findMany({ select: { slotNo: true, workerId: true, agentId: true, expiresAt: true } }),
      tx.companyOsUsage.findMany({ orderBy: { createdAt: 'desc' }, take: 100, select: {
        attemptId: true, agentId: true, provider: true, outcome: true, totalTokens: true, createdAt: true, rulesApplied: true,
      } }),
      tx.$queryRaw<Array<{ state: string; count: bigint }>>(Prisma.sql`
        SELECT CASE WHEN archived.id IS NOT NULL THEN 'ARCHIVED'
          WHEN attempt.outcome = 'SUCCEEDED' THEN 'APPLIED' ELSE 'RECEIVED' END AS state, count(*) AS count
        FROM public."CompanyOsAuditEvent" receipt
        JOIN public."CompanyOsExecutionAttempt" attempt ON attempt.id = receipt.metadata->>'attemptId'
        LEFT JOIN public."CompanyOsAuditEvent" archived ON archived."idempotencyKey" = 'runtime-result-archived:' || attempt.id
        WHERE receipt.action = 'RUNTIME_RESULT_RECEIVED' GROUP BY 1
      `),
      tx.$queryRaw<Array<{ caseId: string; workItemId: string; status: string }>>(Prisma.sql`
        SELECT work."caseId", work.id AS "workItemId", work.status
        FROM public."CompanyOsWorkItem" work JOIN public."CompanyOsCase" company_case ON company_case.id = work."caseId"
        WHERE company_case.status = 'FAILED_FINAL' AND work.status IN ('QUEUED','FAILED_RETRYABLE') LIMIT 100
      `),
    ]);
    return { schemaVersion: 1, generatedAt: new Date().toISOString(), readOnly: true,
      work, attempts, leases, slots,
      usage: usage.map(({ rulesApplied, ...row }) => ({ ...row,
        accountingEstimate: Array.isArray(rulesApplied) && rulesApplied.includes('tokens-are-reserved-estimate') })),
      receiptCounts: receiptCounts.map((row) => ({ ...row, count: Number(row.count) })), strandedCases };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  console.log(JSON.stringify(report, null, 2));
}
main().catch(() => { console.error('Runtime readback unavailable; no connection details emitted.'); process.exitCode = 1; })
  .finally(() => db.$disconnect());
