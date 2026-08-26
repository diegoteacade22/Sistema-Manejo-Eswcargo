import { createHmac, timingSafeEqual } from 'node:crypto';

const MAX_CLOCK_SKEW_SECONDS = 300;

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function signCompanyOsWorkerPayload(rawBody: string, timestamp = Math.floor(Date.now() / 1000)) {
  const secret = (process.env.COMPANY_OS_V3_HMAC_SECRET ?? '').trim();
  if (!secret) throw new Error('COMPANY_OS_V3_HMAC_SECRET no configurado');
  const signature = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return { timestamp: String(timestamp), signature: `sha256=${signature}` };
}

export function verifyCompanyOsWorkerRequest(request: Request, rawBody: string) {
  const timestampRaw = request.headers.get('x-company-os-timestamp') ?? '';
  const provided = request.headers.get('x-company-os-signature') ?? '';
  const timestamp = Number(timestampRaw);
  if (!Number.isInteger(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > MAX_CLOCK_SKEW_SECONDS) return false;
  try {
    const expected = signCompanyOsWorkerPayload(rawBody, timestamp).signature;
    return safeEqual(provided, expected);
  } catch {
    return false;
  }
}

export type CompanyOsRuntimeAuth = {
  workerId: string;
  nonce: string;
  timestamp: number;
  signatureVersion: 'v2';
};

function runtimeSecret() {
  const secret = (process.env.COMPANY_OS_RUNTIME_HMAC_SECRET ?? '').trim();
  if (!secret) throw new Error('COMPANY_OS_RUNTIME_HMAC_SECRET no configurado');
  return secret;
}

function allowedRuntimeWorkerIds() {
  const configured = (
    process.env.COMPANY_OS_RUNTIME_ALLOWED_WORKER_IDS
    ?? process.env.COMPANY_OS_RUNTIME_PRIMARY_WORKER_ID
    ?? 'diegoserver-company-os'
  );
  return new Set(configured.split(',').map((value) => value.trim()).filter((value) =>
    /^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,127}$/.test(value),
  ));
}

export function signCompanyOsRuntimePayload(
  rawBody: string,
  input: { workerId: string; nonce: string; timestamp?: number },
) {
  const workerId = input.workerId.trim();
  const nonce = input.nonce.trim();
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,127}$/.test(workerId)) throw new Error('workerId inválido');
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(nonce)) throw new Error('nonce inválido');
  const signature = createHmac('sha256', runtimeSecret())
    .update(`${workerId}.${nonce}.${timestamp}.${rawBody}`)
    .digest('hex');
  return {
    workerId,
    nonce,
    timestamp: String(timestamp),
    signature: `sha256=${signature}`,
    signatureVersion: 'v2' as const,
  };
}

export function verifyCompanyOsRuntimeRequest(request: Request, rawBody: string): CompanyOsRuntimeAuth | null {
  const workerId = request.headers.get('x-company-os-worker-id')?.trim() ?? '';
  const nonce = request.headers.get('x-company-os-nonce')?.trim() ?? '';
  const timestampRaw = request.headers.get('x-company-os-timestamp')?.trim() ?? '';
  const provided = request.headers.get('x-company-os-signature')?.trim() ?? '';
  const signatureVersion = request.headers.get('x-company-os-signature-version')?.trim() ?? '';
  const timestamp = Number(timestampRaw);
  if (signatureVersion !== 'v2') return null;
  if (!allowedRuntimeWorkerIds().has(workerId)) return null;
  if (!Number.isInteger(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > MAX_CLOCK_SKEW_SECONDS) return null;
  try {
    const expected = signCompanyOsRuntimePayload(rawBody, { workerId, nonce, timestamp }).signature;
    if (!safeEqual(provided, expected)) return null;
    return { workerId, nonce, timestamp, signatureVersion: 'v2' };
  } catch {
    return null;
  }
}
