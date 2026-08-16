import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { signCompanyOsWorkerPayload, verifyCompanyOsWorkerRequest } from '../lib/company-os/v3-auth';
import { estimateCompanyOsCost } from '../lib/company-os/v3-store';
import {
  COMPANY_OS_MISSION_STATUSES,
  COMPANY_OS_REQUEST_STATUSES,
  COMPANY_OS_V3_INPUT_BUDGET,
  COMPANY_OS_V3_MAX_OUTPUT_TOKENS,
  COMPANY_OS_V3_TARGET_TOTAL_TOKENS,
} from '../lib/company-os/v3-types';

test('solicitudes y misiones conservan ciclos tipados independientes', () => {
  assert.deepEqual(COMPANY_OS_REQUEST_STATUSES, ['QUEUED','ANALYZING','AWAITING_REVIEW','BLOCKED','FAILED','CANCELLED','COMPLETED']);
  assert.deepEqual(COMPANY_OS_MISSION_STATUSES, ['PLANNED','APPROVED','REJECTED','REVIEW','BLOCKED','RUNNING','DONE']);
  assert.equal(COMPANY_OS_REQUEST_STATUSES.includes('RUNNING' as never), false);
  assert.equal(COMPANY_OS_REQUEST_STATUSES.includes('DONE' as never), false);
  assert.equal(COMPANY_OS_MISSION_STATUSES.includes('COMPLETED' as never), false);
});

test('presupuesto V3 separa entrada y salida', () => {
  assert.equal(COMPANY_OS_V3_MAX_OUTPUT_TOKENS, 3000);
  assert.equal(COMPANY_OS_V3_TARGET_TOTAL_TOKENS, 12000);
  assert.equal(COMPANY_OS_V3_INPUT_BUDGET, 9000);
});

test('HMAC valida body exacto y ventana temporal', () => {
  process.env.COMPANY_OS_V3_HMAC_SECRET = 'test-secret';
  const rawBody = JSON.stringify({ requestId: 'request-1' });
  const now = Math.floor(Date.now() / 1000);
  const signed = signCompanyOsWorkerPayload(rawBody, now);
  const request = new Request('https://example.test', { headers: {
    'x-company-os-timestamp': signed.timestamp,
    'x-company-os-signature': signed.signature,
  } });
  assert.equal(verifyCompanyOsWorkerRequest(request, rawBody), true);
  assert.equal(verifyCompanyOsWorkerRequest(request, `${rawBody} `), false);
});

test('migración aplica RLS, rol dedicado y sólo tablas internas V3', () => {
  const sql = readFileSync('../supabase/migrations/20260816163045_company_os_v3.sql', 'utf8');
  assert.match(sql, /CREATE ROLE company_os_v3/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /NOBYPASSRLS/);
  assert.match(sql, /REVOKE ALL ON TABLE/);
  assert.doesNotMatch(sql, /(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\."?(?:Order|Product|Shipment|Purchase|Expense)/i);
  assert.match(sql, /Company OS V3 cannot execute missions/);
  assert.match(sql, /FOREIGN KEY \("requestId", "leaseToken", "caseId"\)/);
});

test('costo separa input ordinario, cache read y cache write sin doble conteo', () => {
  const cost = estimateCompanyOsCost({
    provider: 'openai', model: 'gpt-5.6-sol', inputTokens: 1000, cachedTokens: 200,
    cacheWriteTokens: 100, outputTokens: 50, reasoningTokens: 10, totalTokens: 1050,
  });
  assert.equal(cost, (700 * 5 + 200 * 0.5 + 100 * 6.25 + 50 * 30) / 1_000_000);
});

test('el claim permite un único reintento de FAILED y marca recuperación del webhook', () => {
  const source = readFileSync('lib/company-os/v3-store.ts', 'utf8');
  assert.match(source, /c\.status = 'FAILED'/);
  assert.match(source, /CompanyOsExecutionAttempt[\s\S]*< 2/);
  assert.match(source, /webhookDeliveryStatus === 'FAILED' \? 'RECOVERED'/);
});

test('Telegram conserva intentos append-only y permite una sola reentrega', () => {
  const source = readFileSync('lib/company-os/v3-store.ts', 'utf8');
  assert.match(source, /const attempt = \(previous\[0\]\?\.attempt \?\? 0\) \+ 1/);
  assert.match(source, /if \(attempt > 2\)/);
  assert.match(source, /telegram:\$\{input\.requestId\}:completed:\$\{attempt\}/);
});
