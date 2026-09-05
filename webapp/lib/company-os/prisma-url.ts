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
    url.searchParams.set('connection_limit', '1');
    return url.toString();
  } catch {
    return value;
  }
}
