import { Prisma } from '@prisma/client';

type ObjectiveAuthority = { status: string; startsAt: Date; endsAt: Date };

export function runtimeObjectiveIsActive(goal: ObjectiveAuthority, now: Date) {
  const [start, end, checked] = [goal.startsAt, goal.endsAt, now].map((date) => date.getTime());
  return goal.status === 'ACTIVE' && [start, end, checked].every(Number.isFinite)
    && start <= checked && checked < end;
}

/** Match objective control's goal -> unit -> work lock order. No model/lease before this fence. */
export async function withRuntimeObjectiveClaimFence<T>(
  tx: Prisma.TransactionClient,
  candidate: { caseId: string; caseType: string },
  lockAndRevalidateWork: () => Promise<T | null>,
): Promise<T | null> {
  const goals = await tx.$queryRaw<Array<ObjectiveAuthority & { checkedAt: Date }>>(Prisma.sql`
    SELECT objective.status, objective."startsAt", objective."endsAt", clock_timestamp() AS "checkedAt"
    FROM public."CompanyOsContinuousObjective" objective
    JOIN public."CompanyOsObjectiveUnit" unit ON unit."goalId" = objective.id
    WHERE unit."caseId" = ${candidate.caseId}
    FOR SHARE OF objective
  `);
  if ((candidate.caseType === 'CONTINUOUS_OBJECTIVE' && goals.length !== 1)
    || goals.some((goal) => !runtimeObjectiveIsActive(goal, goal.checkedAt))) return null;
  return lockAndRevalidateWork();
}
