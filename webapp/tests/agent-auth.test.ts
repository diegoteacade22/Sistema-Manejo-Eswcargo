import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { verifyOpenClawSignature } from '@/lib/agent-auth';

test('acepta firma HMAC vigente de OpenClaw', () => {
  const previousSecret = process.env.OPENCLAW_PRICE_LIST_HMAC_SECRET;
  process.env.OPENCLAW_PRICE_LIST_HMAC_SECRET = 'test-secret';
  const body = '';
  const timestamp = Math.floor(Date.now() / 1000);
  const request = new Request('https://example.test/api/price-opportunities/status?date=2026-08-17', {
    method: 'GET',
    headers: {
      'x-openclaw-timestamp': String(timestamp),
      'x-openclaw-signature': `sha256=${crypto.createHmac('sha256', 'test-secret')
        .update(`${timestamp}.GET./api/price-opportunities/status?date=2026-08-17.${body}`)
        .digest('hex')}`,
    },
  });

  assert.equal(verifyOpenClawSignature(request, body), true);
  if (previousSecret === undefined) delete process.env.OPENCLAW_PRICE_LIST_HMAC_SECRET;
  else process.env.OPENCLAW_PRICE_LIST_HMAC_SECRET = previousSecret;
});
