import { companyOsV3Prisma } from './v3-prisma';
import type { SystemsRuntimeReadback } from './systems-runtime-observation';

/** Uses the existing company_os_v3 SELECT grant; reads no secret or business tables. */
export async function readSystemsRuntimeWorkers(): Promise<SystemsRuntimeReadback> {
  try {
    const workers = await companyOsV3Prisma().companyOsWorker.findMany({
      where: { allowedAgentIds: { has: 'systems-manager-ai-v1' } },
      select: {
        workerId: true, host: true, state: true, version: true,
        allowedAgentIds: true, lastHeartbeatAt: true, lastErrorCode: true,
      },
      orderBy: { lastHeartbeatAt: 'desc' },
    });
    return { observed: true, workers };
  } catch {
    return { observed: false, workers: [] };
  }
}
