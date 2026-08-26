import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const RUNTIME_SIGNATURE_VERSION = 'v2';
export const RUNTIME_WORKER_ID_HEADER = 'x-company-os-worker-id';
export const RUNTIME_NONCE_HEADER = 'x-company-os-nonce';
export const RUNTIME_TIMESTAMP_HEADER = 'x-company-os-timestamp';
export const RUNTIME_SIGNATURE_HEADER = 'x-company-os-signature';
export const RUNTIME_SIGNATURE_VERSION_HEADER = 'x-company-os-signature-version';

const WORKER_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export function runtimeSignatureMessage(workerId, nonce, timestamp, rawBody) {
  return `${workerId}.${nonce}.${timestamp}.${rawBody}`;
}

export function runtimeSignatureFor(secret, workerId, nonce, timestamp, rawBody) {
  if (typeof secret !== 'string' || !secret) throw new Error('Runtime HMAC secret is required');
  if (!WORKER_ID_PATTERN.test(workerId)) throw new Error('Runtime workerId is invalid');
  if (!NONCE_PATTERN.test(nonce)) throw new Error('Runtime nonce is invalid');
  if (!/^\d{10}$/.test(timestamp)) throw new Error('Runtime timestamp is invalid');
  return createHmac('sha256', secret)
    .update(runtimeSignatureMessage(workerId, nonce, timestamp, rawBody))
    .digest('hex');
}

export function runtimeSignedHeaders({ secret, workerId, rawBody, nowMs = Date.now(), nonce = randomBytes(16).toString('hex') }) {
  const timestamp = String(Math.floor(nowMs / 1000));
  return {
    [RUNTIME_SIGNATURE_VERSION_HEADER]: RUNTIME_SIGNATURE_VERSION,
    [RUNTIME_WORKER_ID_HEADER]: workerId,
    [RUNTIME_NONCE_HEADER]: nonce,
    [RUNTIME_TIMESTAMP_HEADER]: timestamp,
    [RUNTIME_SIGNATURE_HEADER]: `sha256=${runtimeSignatureFor(secret, workerId, nonce, timestamp, rawBody)}`,
  };
}

export function verifyRuntimeSignedBody({ secret, workerId, nonce, timestamp, signature, rawBody, nowMs = Date.now(), toleranceMs = 300_000 }) {
  if (!WORKER_ID_PATTERN.test(workerId || '') || !NONCE_PATTERN.test(nonce || '') || !/^\d{10}$/.test(timestamp || '')) return false;
  if (typeof signature !== 'string') return false;
  const signedAtMs = Number(timestamp) * 1000;
  if (!Number.isSafeInteger(signedAtMs) || Math.abs(nowMs - signedAtMs) > toleranceMs) return false;
  const supplied = signature.replace(/^sha256=/, '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(supplied)) return false;
  const expected = Buffer.from(runtimeSignatureFor(secret, workerId, nonce, timestamp, rawBody), 'hex');
  const actual = Buffer.from(supplied, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
