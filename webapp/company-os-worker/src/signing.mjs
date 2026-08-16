import { createHmac, timingSafeEqual } from 'node:crypto';

export const TIMESTAMP_HEADER = 'x-company-os-timestamp';
export const SIGNATURE_HEADER = 'x-company-os-signature';

export function signatureFor(secret, timestamp, rawBody) {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
}

function timestampToMs(timestamp) {
  if (!/^\d{10}$/.test(timestamp)) return null;
  return Number(timestamp) * 1000;
}

export function verifySignedBody({ secret, timestamp, signature, rawBody, nowMs = Date.now(), toleranceMs = 300_000 }) {
  if (typeof timestamp !== 'string' || typeof signature !== 'string') return false;
  const signedAtMs = timestampToMs(timestamp);
  if (signedAtMs === null || Math.abs(nowMs - signedAtMs) > toleranceMs) return false;

  const supplied = signature.replace(/^sha256=/, '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(supplied)) return false;

  const expectedBuffer = Buffer.from(signatureFor(secret, timestamp, rawBody), 'hex');
  const suppliedBuffer = Buffer.from(supplied, 'hex');
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

export function signedHeaders(secret, rawBody, nowMs = Date.now()) {
  const timestamp = String(Math.floor(nowMs / 1000));
  return {
    [TIMESTAMP_HEADER]: timestamp,
    [SIGNATURE_HEADER]: `sha256=${signatureFor(secret, timestamp, rawBody)}`,
  };
}
