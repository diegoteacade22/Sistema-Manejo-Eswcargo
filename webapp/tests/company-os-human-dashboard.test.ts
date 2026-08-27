import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createHmac } from 'node:crypto';
import { CompanyOsHumanDashboard } from '../components/company-os-human-dashboard';
import { verifyCodexIntakeRequest } from '../lib/company-os/codex-task-auth';

const page = readFileSync('app/company-os/operations/page.tsx', 'utf8');
const component = readFileSync('components/company-os-human-dashboard.tsx', 'utf8');
const collector = readFileSync('../company-os/codex-task-collector/collector.mjs', 'utf8');
const migration = readFileSync('../supabase/migrations/20260827142708_company_os_codex_task_inventory.sql', 'utf8');

test('el tablero humano es la vista principal y la consola técnica queda colapsada', () => {
  assert.match(page, /<CompanyOsHumanDashboard \/>/);
  assert.match(page, /<details/);
  assert.match(page, /Diagnóstico técnico del sistema/);
  assert.ok(page.indexOf('<CompanyOsHumanDashboard />') < page.indexOf('<CompanyOsEngineeringControlCenter />'));
});

test('la vista inicial usa lenguaje humano y no muestra leases ni fencing', () => {
  const markup = renderToStaticMarkup(React.createElement(CompanyOsHumanDashboard));
  assert.match(markup, /Leyendo tareas de Codex/);
  assert.doesNotMatch(markup, /fencing|capability lease|effect ledger/i);
  for (const label of ['Trabajando ahora', 'Necesito que decidas', 'El agente puede trabajar ahora', 'Con problemas', 'Ideas y ofertas', 'Realizadas']) {
    assert.match(component, new RegExp(label));
  }
});

test('las ofertas exponen costo, precio sugerido, margen y fuente real', () => {
  assert.match(component, /suggestedPriceUsd/);
  assert.match(component, /costUsd/);
  assert.match(component, /marginPct/);
  assert.match(component, /Fuente:/);
  assert.match(component, /no se publican solas/);
});

test('collector excluye subagentes, no envía texto final y nunca convierte task_complete en DONE', () => {
  assert.match(collector, /parent_thread_id \|\| inspected\.meta\.agent_path \|\| inspected\.meta\.forked_from_id/);
  assert.doesNotMatch(collector, /lastFinalText,\s*priority/);
  assert.match(collector, /humanStatus: 'READY_REVIEW'/);
  assert.doesNotMatch(collector, /humanStatus: 'DONE'/);
  const store = readFileSync('lib/company-os/codex-task-store.ts', 'utf8');
  assert.match(store, /codex:\/\/threads\/\$\{threadId\}/);
});

test('inventario durable es interno, saneado y append-only para observaciones', () => {
  for (const table of ['CompanyOsCodexTask', 'CompanyOsCodexTaskObservation', 'CompanyOsCodexInventorySync']) {
    assert.match(migration, new RegExp(`CREATE TABLE public\\."${table}"`));
  }
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /company_os_codex_observation_append_only/);
  assert.doesNotMatch(migration, /rawText|prompt|conversation|cwd/);
});

test('intake Codex usa un secreto dedicado, identidad fija, timestamp y body exacto', () => {
  const prior = process.env.COMPANY_OS_CODEX_INTAKE_HMAC_SECRET;
  process.env.COMPANY_OS_CODEX_INTAKE_HMAC_SECRET = 'collector-secret-for-test';
  const workerId = 'codex-intake-ai-v1';
  const nonce = 'abcdefghijklmnop';
  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ workerId, instanceId: 'test' });
  const signature = `sha256=${createHmac('sha256', process.env.COMPANY_OS_CODEX_INTAKE_HMAC_SECRET).update(`${workerId}.${nonce}.${timestamp}.${body}`).digest('hex')}`;
  const request = new Request('https://example.test/api/company-os/codex/v1/intake', { headers: {
    'x-company-os-worker-id': workerId,
    'x-company-os-nonce': nonce,
    'x-company-os-timestamp': String(timestamp),
    'x-company-os-signature-version': 'v2',
    'x-company-os-signature': signature,
  } });
  assert.ok(verifyCodexIntakeRequest(request, body));
  assert.equal(verifyCodexIntakeRequest(request, `${body} `), null);
  if (prior === undefined) delete process.env.COMPANY_OS_CODEX_INTAKE_HMAC_SECRET;
  else process.env.COMPANY_OS_CODEX_INTAKE_HMAC_SECRET = prior;
});
