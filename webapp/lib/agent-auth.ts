import { createHmac, timingSafeEqual } from 'node:crypto';

const MAX_CLOCK_SKEW_SECONDS = 300;

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function providedApiKey(request: Request) {
  const direct = request.headers.get('x-agent-key')?.trim();
  if (direct) return direct;
  const authorization = request.headers.get('authorization')?.trim();
  return authorization?.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : '';
}

function signedTarget(request: Request) {
  const url = new URL(request.url);
  return `${url.pathname}${url.search}`;
}

export function verifyOpenClawSignature(request: Request, rawBody: string) {
  const secret = (process.env.OPENCLAW_PRICE_LIST_HMAC_SECRET || '').trim();
  const timestampRaw = request.headers.get('x-openclaw-timestamp') || '';
  const provided = request.headers.get('x-openclaw-signature') || '';
  const timestamp = Number(timestampRaw);
  if (!secret || !Number.isInteger(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > MAX_CLOCK_SKEW_SECONDS) {
    return false;
  }

  const canonical = `${timestamp}.${request.method.toUpperCase()}.${signedTarget(request)}.${rawBody}`;
  const expected = `sha256=${createHmac('sha256', secret).update(canonical).digest('hex')}`;
  return safeEqual(provided, expected);
}

export function verifyAgentRequest(request: Request, rawBody: string) {
  const expectedKey = (process.env.AGENT_API_KEY || '').trim();
  const providedKey = providedApiKey(request);
  if (expectedKey && providedKey && safeEqual(providedKey, expectedKey)) return true;
  return verifyOpenClawSignature(request, rawBody);
}
