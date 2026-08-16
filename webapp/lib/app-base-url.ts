type AppUrlEnvironment = Partial<Record<
  'NEXT_PUBLIC_APP_URL' | 'AUTH_URL' | 'NEXTAUTH_URL' | 'VERCEL_PROJECT_PRODUCTION_URL' | 'VERCEL_URL' | 'NODE_ENV',
  string
>>;

const PRODUCTION_HOSTS = new Set(['webapp-weld-psi.vercel.app']);

function normalizeHttpUrl(value: string | undefined, env: AppUrlEnvironment) {
  const candidate = value?.trim().replace(/\/+$/, '');
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    const pureOrigin = parsed.origin === candidate && !parsed.username && !parsed.password && parsed.pathname === '/' && !parsed.search && !parsed.hash;
    if (!pureOrigin) return null;
    if (env.NODE_ENV !== 'production' && parsed.protocol === 'http:' && ['localhost','127.0.0.1'].includes(parsed.hostname)) return parsed.origin;
    const vercelProductionHost = (env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL)?.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
    const allowed = PRODUCTION_HOSTS.has(parsed.hostname) || parsed.hostname === vercelProductionHost;
    return parsed.protocol === 'https:' && allowed ? parsed.origin : null;
  } catch {
    return null;
  }
}

export function resolveAppBaseUrl(env: AppUrlEnvironment = process.env) {
  for (const candidate of [env.NEXT_PUBLIC_APP_URL, env.AUTH_URL, env.NEXTAUTH_URL]) {
    const normalized = normalizeHttpUrl(candidate, env);
    if (normalized) return normalized;
  }

  const vercelHost = env.VERCEL_PROJECT_PRODUCTION_URL?.trim() || env.VERCEL_URL?.trim();
  if (vercelHost) {
    const normalized = normalizeHttpUrl(`https://${vercelHost.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`, env);
    if (normalized) return normalized;
  }

  if (env.NODE_ENV === 'production') {
    throw new Error('Missing canonical application URL in production');
  }
  return 'http://localhost:3000';
}
