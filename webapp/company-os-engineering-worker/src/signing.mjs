import { createHmac, randomBytes } from 'node:crypto';

export function signedHeaders({ secret, workerId, rawBody, nowMs = Date.now(), nonce = randomBytes(16).toString('hex') }) {
  if (!secret) throw new Error('ENGINEERING_HMAC_SECRET_REQUIRED');
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(workerId)) throw new Error('ENGINEERING_WORKER_ID_INVALID');
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) throw new Error('ENGINEERING_NONCE_INVALID');
  const timestamp = String(Math.floor(nowMs / 1000));
  const signature = createHmac('sha256', secret)
    .update(`${workerId}.${nonce}.${timestamp}.${rawBody}`)
    .digest('hex');
  return {
    'x-company-os-signature-version': 'v2',
    'x-company-os-worker-id': workerId,
    'x-company-os-nonce': nonce,
    'x-company-os-timestamp': timestamp,
    'x-company-os-signature': `sha256=${signature}`,
  };
}
