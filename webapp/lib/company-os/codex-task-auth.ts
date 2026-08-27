import { createHmac, timingSafeEqual } from 'node:crypto';

const CLOCK_SKEW_SECONDS = 300;

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyCodexIntakeRequest(request: Request, rawBody: string) {
  const secret = (process.env.COMPANY_OS_CODEX_INTAKE_HMAC_SECRET ?? '').trim();
  const workerId = request.headers.get('x-company-os-worker-id')?.trim() ?? '';
  const nonce = request.headers.get('x-company-os-nonce')?.trim() ?? '';
  const timestampRaw = request.headers.get('x-company-os-timestamp')?.trim() ?? '';
  const signature = request.headers.get('x-company-os-signature')?.trim() ?? '';
  const version = request.headers.get('x-company-os-signature-version')?.trim() ?? '';
  const timestamp = Number(timestampRaw);
  if (!secret || workerId !== 'codex-intake-ai-v1' || version !== 'v2') return null;
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) return null;
  if (!Number.isInteger(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > CLOCK_SKEW_SECONDS) return null;
  const expected = `sha256=${createHmac('sha256', secret).update(`${workerId}.${nonce}.${timestamp}.${rawBody}`).digest('hex')}`;
  return safeEqual(signature, expected) ? { workerId, nonce, timestamp } : null;
}
