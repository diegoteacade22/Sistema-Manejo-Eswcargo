import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { signCompanyOsWorkerPayload, verifyCompanyOsWorkerRequest } from '../lib/company-os/v3-auth';
import { estimateCompanyOsCost, startOfCompanyOsDay } from '../lib/company-os/v3-store';
import { deterministicRiskScore } from '../lib/company-os/systems-snapshot';
import {
  COMPANY_OS_MISSION_STATUSES,
  COMPANY_OS_REQUEST_STATUSES,
  COMPANY_OS_V3_INPUT_BUDGET,
  COMPANY_OS_V3_MAX_OUTPUT_TOKENS,
  COMPANY_OS_V3_TARGET_TOTAL_TOKENS,
  COMPANY_OS_AGENT_CONTRACTS,
  COMPANY_OS_AGENT_IDS,
  companyOsDailyTokenLimit,
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
  const hardening = readFileSync('../supabase/migrations/20260816174230_company_os_v3_function_search_path.sql', 'utf8');
  assert.match(hardening, /company_os_v3_reject_mutation\(\) SET search_path = ''/);
  assert.match(hardening, /company_os_v3_guard_mission_status\(\) SET search_path = ''/);
});

test('costo separa input ordinario, cache read y cache write sin doble conteo', () => {
  const cost = estimateCompanyOsCost({
    provider: 'openai', model: 'gpt-5.6-sol', inputTokens: 1000, cachedTokens: 200,
    cacheWriteTokens: 100, outputTokens: 50, reasoningTokens: 10, totalTokens: 1050,
  });
  assert.equal(cost, (700 * 5 + 200 * 0.5 + 100 * 6.25 + 50 * 30) / 1_000_000);
});

test('acumulado diario respeta medianoche America/New_York con DST', () => {
  assert.equal(startOfCompanyOsDay(new Date('2026-08-16T18:00:00Z')).toISOString(), '2026-08-16T04:00:00.000Z');
  assert.equal(startOfCompanyOsDay(new Date('2026-01-16T18:00:00Z')).toISOString(), '2026-01-16T05:00:00.000Z');
});

test('límite diario es independiente por agente y bloquea antes del modelo', () => {
  process.env.COMPANY_OS_SYSTEMS_DAILY_TOKEN_LIMIT = '36000';
  process.env.COMPANY_OS_GENERAL_DAILY_TOKEN_LIMIT = '60000';
  assert.equal(companyOsDailyTokenLimit('systems-manager-ai-v1'), 36000);
  assert.equal(companyOsDailyTokenLimit('general-manager-ai-v3'), 60000);
  const source = readFileSync('lib/company-os/v3-store.ts', 'utf8');
  assert.match(source, /CASE_BLOCKED_DAILY_BUDGET/);
  assert.match(source, /dailyUsed \+ companyCase\.targetTotalTokens > dailyLimit/);
  delete process.env.COMPANY_OS_SYSTEMS_DAILY_TOKEN_LIMIT;
  delete process.env.COMPANY_OS_GENERAL_DAILY_TOKEN_LIMIT;
});

test('el claim permite un único reintento de FAILED y marca recuperación del webhook', () => {
  const source = readFileSync('lib/company-os/v3-store.ts', 'utf8');
  assert.match(source, /c\.status = 'FAILED'/);
  assert.match(source, /CompanyOsExecutionAttempt[\s\S]*< 2/);
  assert.match(source, /webhookDeliveryStatus === 'FAILED' \? 'RECOVERED'/);
});

test('Telegram conserva intentos append-only y permite una sola reentrega', () => {
  const source = readFileSync('lib/company-os/v3-store.ts', 'utf8');
  assert.match(source, /status: 'PENDING'/);
  assert.match(source, /completed:intent:\$\{attempt\}/);
  assert.match(source, /completed:result:\$\{reservation\.attempt\}/);
  assert.match(source, /if \(attempt > 2\)/);
});

test('registro cerrado integra Gerente de Sistemas y línea de reporte', () => {
  assert.deepEqual(COMPANY_OS_AGENT_IDS, ['general-manager-ai-v3', 'systems-manager-ai-v1']);
  assert.equal(COMPANY_OS_AGENT_CONTRACTS['systems-manager-ai-v1'].displayName, 'Gerente de Sistemas AI');
  assert.equal(COMPANY_OS_AGENT_CONTRACTS['systems-manager-ai-v1'].reportsToAgentId, 'general-manager-ai-v3');
  assert.equal(COMPANY_OS_AGENT_CONTRACTS['systems-manager-ai-v1'].area, 'SYSTEMS');
});

test('migración Sistemas es aditiva, RLS forzado, agenda NY y sin DML empresarial', () => {
  const sql = readFileSync('../supabase/migrations/20260816184500_systems_manager_ai_v1.sql', 'utf8');
  assert.match(sql, /CompanyOsSystemSnapshot/);
  assert.match(sql, /CompanyOsSystemAsset/);
  assert.match(sql, /CompanyOsSystemDependency/);
  assert.match(sql, /CompanyOsSystemHealthObservation/);
  assert.match(sql, /CompanyOsSystemCoverageObservation/);
  assert.match(sql, /CompanyOsSystemRiskHistory/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /America\/New_York/);
  assert.match(sql, /time '08:00:00'/);
  assert.match(sql, /scheduleRunKey/);
  assert.match(sql, /permits at most five ACTION_REQUIRED/);
  assert.doesNotMatch(sql, /(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\."?(?:Order|Product|Shipment|Purchase|Expense)/i);
});

test('hardening agrega rol aislado, revisión humana y consumo completo', () => {
  const sql = readFileSync('../supabase/migrations/20260816192500_systems_manager_ai_v1_hardening.sql', 'utf8');
  assert.match(sql, /CREATE ROLE systems_manager_ai_v1 NOLOGIN/);
  assert.match(sql, /NOBYPASSRLS/);
  assert.match(sql, /MARK_INCORRECT/);
  assert.match(sql, /CompanyOsSystemRiskHistory/);
  assert.match(sql, /responseId/);
  assert.match(sql, /durationMs/);
  assert.match(sql, /snapshotBytes/);
  assert.match(sql, /REVOKE ALL ON ALL TABLES IN SCHEMA public FROM systems_manager_ai_v1/);
  assert.doesNotMatch(sql, /GRANT (?:SELECT|INSERT|UPDATE|DELETE)[^;]*\"Order\"/i);
});

test('store selecciona agente persistido, materializa snapshot y no tiene DML empresarial', () => {
  const source = readFileSync('lib/company-os/v3-store.ts', 'utf8');
  assert.match(source, /agentId === 'systems-manager-ai-v1'/);
  assert.match(source, /buildSystemsSnapshot/);
  assert.match(source, /persistSystemsSnapshot/);
  assert.match(source, /c\."agentId"/);
  assert.match(source, /case: \{ agentId: existing\.agentId \}/);
  assert.doesNotMatch(source, /(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\."?(?:Order|Product|Shipment|Purchase|Expense)/i);
});

test('inventario declara AWS archivado, Mac mini futura y no materializa secretos', () => {
  const source = readFileSync('lib/company-os/systems-snapshot.ts', 'utf8');
  assert.match(source, /assetId:'aws-archive'[\s\S]*lifecycleStatus:'ARCHIVED'/);
  assert.match(source, /assetId:'mac-mini-future'[\s\S]*lifecycleStatus:'FUTURE'/);
  assert.match(source, /valueIncluded:false/);
  assert.doesNotMatch(source, /process\.env\.COMPANY_OS_V3_HMAC_SECRET\s*[),]/);
});

test('score técnico es determinístico y responde a todos los factores requeridos', () => {
  const base = { impact:.8, probability:.6, urgency:.7, assetCriticality:1, blastRadius:.8, fallbackCoverage:.2, age:.5, confidence:.95, evidenceQuality:.95, solutionReversibility:.9 };
  const score = deterministicRiskScore(base);
  assert.equal(score, deterministicRiskScore(base));
  assert.ok(score >= 75 && score <= 100);
  assert.ok(deterministicRiskScore({ ...base, fallbackCoverage: 1, impact: .2 }) < score);
});
