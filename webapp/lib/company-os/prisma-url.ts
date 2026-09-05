/**
 * Vercel can keep several serverless Prisma clients alive against Supavisor.
 * One connection per client keeps the dedicated Company OS roles below their
 * session-mode pool ceiling while preserving the configured endpoint.
 */
export function companyOsPrismaUrl(raw: string, nodeEnv = process.env.NODE_ENV) {
  const value = raw.trim();
  if (!value || nodeEnv !== 'production') return value;
  try {
    const url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) return value;
    if (url.hostname.endsWith('.pooler.supabase.com') && (!url.port || url.port === '5432')) {
      url.port = '6543';
      url.searchParams.set('pgbouncer', 'true');
    }
    url.searchParams.set('connection_limit', '1');
    return url.toString();
  } catch {
    return value;
  }
}
