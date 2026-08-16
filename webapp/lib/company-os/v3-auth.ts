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

