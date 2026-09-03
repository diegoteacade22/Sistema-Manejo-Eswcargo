import type { Prisma } from '@prisma/client';
import { COMPANY_OS_DATA_MANAGER_IDENTITY } from './v3-types';

export type CompanyOsRuntimeDataPolicy = {
  version: 1;
  inference: 'LOCAL_ONLY' | 'STANDARD';
  reason: 'DATA_MANAGER_LINEAGE' | 'DEFAULT';
};

/** Derive policy from the complete durable case, never the truncated model context. */
export async function resolveCompanyOsRuntimeDataPolicy(
  tx: Prisma.TransactionClient,
  caseId: string,
  agentId: string,
): Promise<CompanyOsRuntimeDataPolicy> {
  const [companyCase, dataWork, dataMessage] = await Promise.all([
    tx.companyOsCase.findUniqueOrThrow({ where: { id: caseId }, select: { agentId: true } }),
    tx.companyOsWorkItem.findFirst({
      where: { caseId, agentId: COMPANY_OS_DATA_MANAGER_IDENTITY },
      select: { id: true },
    }),
    tx.companyOsMessage.findFirst({
      where: {
        caseId,
        OR: [
          { fromAgentId: COMPANY_OS_DATA_MANAGER_IDENTITY },
          { toAgentId: COMPANY_OS_DATA_MANAGER_IDENTITY },
        ],
      },
      select: { id: true },
    }),
  ]);
  const localOnly = agentId === COMPANY_OS_DATA_MANAGER_IDENTITY
    || companyCase.agentId === COMPANY_OS_DATA_MANAGER_IDENTITY
    || dataWork !== null
    || dataMessage !== null;
  return {
    version: 1,
    inference: localOnly ? 'LOCAL_ONLY' : 'STANDARD',
    reason: localOnly ? 'DATA_MANAGER_LINEAGE' : 'DEFAULT',
  };
}
