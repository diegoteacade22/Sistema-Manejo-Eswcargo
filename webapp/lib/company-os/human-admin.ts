import { createHash } from 'node:crypto';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasValidCompanyAgentKey } from './auth';
import type { HumanMissionIdentity } from './mission-events';

export type HumanAdminAuthResult =
  | { ok: true; identity: HumanMissionIdentity }
  | { ok: false; status: 401 | 403; error: string };

function humanActorRef(userId: string) {
  return createHash('sha256').update(`admin-session:${userId}`).digest('hex').slice(0, 20);
}

export function hasTrustedHumanRequestOrigin(request: Request) {
  const origin = request.headers.get('origin')?.trim();
  if (origin) {
    try {
      return new URL(origin).origin === new URL(request.url).origin;
    } catch {
      return false;
    }
  }
  if (process.env.NODE_ENV === 'test') return true;
  return request.headers.get('x-company-os-server-request') === '1'
    && !request.headers.get('sec-fetch-site');
}

export async function requireHumanCompanyAdmin(request: Request): Promise<HumanAdminAuthResult> {
  if (hasValidCompanyAgentKey(request)) {
    return { ok: false, status: 403, error: 'La clave de máquina no puede tomar decisiones humanas' };
  }

  const session = await auth();
  const sessionUser = session?.user as { id?: string; role?: string } | undefined;
  if (!sessionUser?.id || sessionUser.role !== 'ADMIN') {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }
  const currentUser = await prisma.user.findUnique({ where: { id: sessionUser.id }, select: { role: true } });
  if (currentUser?.role !== 'ADMIN') {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }
  return {
    ok: true,
    identity: { authMode: 'admin-session', actorRef: humanActorRef(sessionUser.id) },
  };
}
