import { createHmac, randomBytes } from 'node:crypto';

export const ENGINEERING_SIGNATURE_DOMAIN = 'company-os-engineering';
export const ENGINEERING_SIGNATURE_VERSION = 'engineering-v3';

export function engineeringSignatureMessage({ method, pathname, workerId, nonce, timestamp, rawBody }) {
  const normalizedMethod = method.trim().toUpperCase();
  const normalizedPathname = pathname.trim();
  if (!/^[A-Z]{3,12}$/.test(normalizedMethod)) throw new Error('ENGINEERING_HTTP_METHOD_INVALID');
  if (!normalizedPathname.startsWith('/api/company-os/engineering/v2/') || normalizedPathname.includes('?') || normalizedPathname.includes('#')) {
    throw new Error('ENGINEERING_HTTP_PATHNAME_INVALID');
  }
  return [
    ENGINEERING_SIGNATURE_DOMAIN,
    ENGINEERING_SIGNATURE_VERSION,
    normalizedMethod,
    normalizedPathname,
    workerId,
    nonce,
    timestamp,
    rawBody,
  ].map((value) => `${Buffer.byteLength(value, 'utf8')}:${value}`).join('|');
}

export function signedHeaders({ secret, method, pathname, workerId, rawBody, nowMs = Date.now(), nonce = randomBytes(16).toString('hex') }) {
  if (!secret) throw new Error('ENGINEERING_HMAC_SECRET_REQUIRED');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(workerId)) throw new Error('ENGINEERING_WORKER_ID_INVALID');
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) throw new Error('ENGINEERING_NONCE_INVALID');
  const timestamp = String(Math.floor(nowMs / 1000));
  const signature = createHmac('sha256', secret)
    .update(engineeringSignatureMessage({ method, pathname, workerId, nonce, timestamp, rawBody }))
    .digest('hex');
  return {
    'x-company-os-signature-version': ENGINEERING_SIGNATURE_VERSION,
    'x-company-os-worker-id': workerId,
    'x-company-os-nonce': nonce,
    'x-company-os-timestamp': timestamp,
    'x-company-os-signature': `sha256=${signature}`,
  };
}
