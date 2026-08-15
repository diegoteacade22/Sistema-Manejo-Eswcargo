import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDeterministicFallback, generateGeneralManagerBrief } from '../lib/company-os/general-manager';
import { hasValidCompanyAgentKey } from '../lib/company-os/auth';
import { companyAgentRequestKey } from '../lib/company-os/run-store';
import { sanitizeCompanyObjective } from '../lib/company-os/objective';
import type { CompanySnapshot } from '../lib/company-os/types';

const snapshot: CompanySnapshot = {
  snapshotId: 'snapshot-test-001',
  generatedAt: '2026-08-15T16:00:00.000Z',
  businessDate: '2026-08-15',
  timeZone: 'America/New_York',
  source: 'ESWCARGO_PRODUCTION_READ_ONLY',
  metrics: {
    ordersLast7Days: 12,
    revenueLast7DaysUsd: 12000,
    ordersNonUsdLast7Days: 0,
    ordersToBuy: 4,
    productsActive: 100,
    unitsInStock: 25,
    productsWithoutStock: 60,
    shipmentsInTransit: 3,
    delayedShipments: 1,
    purchasesPending: 2,
    purchasesBalanceUsd: 3400,
    expensesLast30DaysUsd: 900,
  },
  distributions: {
    orderStatus: [{ status: 'COMPRAR', count: 4 }],
    shipmentStatus: [{ status: 'EN TRANSITO', count: 3 }],
  },
  freshness: {
    latestOrderUpdate: '2026-08-15T15:00:00.000Z',
    latestProductUpdate: '2026-08-15T15:00:00.000Z',
    latestShipmentUpdate: '2026-08-15T15:00:00.000Z',
    latestSync: {
      id: 608,
      status: 'SUCCESS',
      scope: 'DIRECT_STATUS_RECOVERY',
      startedAt: '2026-08-15T14:00:00.000Z',
      finishedAt: '2026-08-15T14:01:00.000Z',
      ageHours: 2,
      fresh: true,
    },
  },
};

const modelOutput = {
  schemaVersion: '1',
  status: 'NEEDS_ATTENTION',
  executiveSummary: 'Hay dos frentes operativos prioritarios.',
  priorities: [
    {
      id: 'P-001',
      title: 'Revisar envíos demorados',
      area: 'LOGISTICA',
      urgency: 'P0',
      evidence: ['1 envío supera 14 días'],
      recommendedAction: 'Preparar excepción con evidencia.',
      owner: 'Logística',
      dueWindow: '24 horas',
      requiresHumanApproval: true,
    },
  ],
  delegations: [
    {
      agent: 'LOGISTICA',
      mission: 'Preparar lista de excepciones.',
      why: 'Existe un envío demorado.',
      expectedOutput: 'Informe read-only.',
    },
  ],
  dataQuality: {
    cutoff: snapshot.generatedAt,
    coverage: ['Pedidos', 'Envíos'],
    gaps: [],
  },
  guardrails: ['Solo lectura'],
};

test('fallback conserva read-only y limita prioridades', () => {
  const brief = buildDeterministicFallback(snapshot, 'modelo no disponible');
  assert.equal(brief.execution.provider, 'deterministic-fallback');
  assert.equal(brief.execution.businessDataReadOnly, true);
  assert.equal(brief.execution.auditWrite, 'CompanyAgentRun');
  assert.ok(brief.priorities.length <= 5);
  assert.ok(brief.priorities.every((priority) => priority.recommendedAction.length > 0));
  assert.deepEqual(brief.warnings, ['modelo no disponible']);
});

test('Responses API usa salida estructurada, no usa tools y enlaza snapshot', async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousModel = process.env.COMPANY_OS_MODEL;
  process.env.OPENAI_API_KEY = 'test-key-never-sent';
  process.env.COMPANY_OS_MODEL = 'gpt-test';
  let requestBody: unknown;

  const mockFetch: typeof fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      id: 'resp_test_001',
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(modelOutput) }] }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const brief = await generateGeneralManagerBrief(snapshot, 'Organizar la semana', mockFetch);
    const parsedBody = requestBody as {
      store: boolean;
      model: string;
      text: { format: { type: string; strict: boolean } };
      tools?: unknown;
    };
    assert.equal(parsedBody.store, false);
    assert.equal(parsedBody.model, 'gpt-test');
    assert.equal(parsedBody.text.format.type, 'json_schema');
    assert.equal(parsedBody.text.format.strict, true);
    assert.equal(parsedBody.tools, undefined);
    assert.equal(brief.execution.provider, 'openai');
    assert.equal(brief.execution.responseId, 'resp_test_001');
    assert.equal(brief.execution.snapshotId, snapshot.snapshotId);
    assert.equal(brief.priorities.length, 1);
  } finally {
    if (previousKey == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousModel == null) delete process.env.COMPANY_OS_MODEL;
    else process.env.COMPANY_OS_MODEL = previousModel;
  }
});

test('sin OPENAI_API_KEY falla cerrado con fallback explícito', async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const brief = await generateGeneralManagerBrief(snapshot);
    assert.equal(brief.execution.provider, 'deterministic-fallback');
    assert.match(brief.warnings[0], /OPENAI_API_KEY/);
  } finally {
    if (previousKey != null) process.env.OPENAI_API_KEY = previousKey;
  }
});

test('la autenticación de máquina usa solo COMPANY_OS_API_KEY y acepta bearer', () => {
  const previousKey = process.env.COMPANY_OS_API_KEY;
  process.env.COMPANY_OS_API_KEY = 'company-os-test-key';
  try {
    assert.equal(hasValidCompanyAgentKey(new Request('https://example.test', { headers: { 'x-agent-key': 'wrong' } })), false);
    assert.equal(hasValidCompanyAgentKey(new Request('https://example.test', { headers: { authorization: 'Bearer company-os-test-key' } })), true);
  } finally {
    if (previousKey == null) delete process.env.COMPANY_OS_API_KEY;
    else process.env.COMPANY_OS_API_KEY = previousKey;
  }
});

test('la clave idempotente cambia con snapshot, objetivo, modelo o política', () => {
  const first = companyAgentRequestKey('snap-1', 'objective-hash-1', 'gpt-5.6', 'policy-1');
  assert.equal(first, companyAgentRequestKey('snap-1', 'objective-hash-1', 'gpt-5.6', 'policy-1'));
  assert.notEqual(first, companyAgentRequestKey('snap-2', 'objective-hash-1', 'gpt-5.6', 'policy-1'));
  assert.notEqual(first, companyAgentRequestKey('snap-1', 'objective-hash-2', 'gpt-5.6', 'policy-1'));
  assert.notEqual(first, companyAgentRequestKey('snap-1', 'objective-hash-1', 'otro-modelo', 'policy-1'));
  assert.notEqual(first, companyAgentRequestKey('snap-1', 'objective-hash-1', 'gpt-5.6', 'policy-2'));
});

test('redacta secretos, email y teléfono y no conserva el objetivo raw', () => {
  const result = sanitizeCompanyObjective('Contactar a diego@example.com, +1 305 555 1234, api_key=sk-abcdefghijklmnop');
  assert.equal(result.safeObjective.includes('diego@example.com'), false);
  assert.equal(result.safeObjective.includes('305 555 1234'), false);
  assert.equal(result.safeObjective.includes('sk-abcdefghijklmnop'), false);
  assert.ok(result.redactions >= 3);
  assert.equal(result.objectiveHash.length, 64);
});

test('rechaza Responses API incompleta aunque devuelva HTTP 200', async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key-never-sent';
  const mockFetch: typeof fetch = async () => new Response(JSON.stringify({
    id: 'resp_incomplete',
    status: 'incomplete',
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(modelOutput) }] }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  try {
    await assert.rejects(() => generateGeneralManagerBrief(snapshot, '', mockFetch), /incompleta/);
  } finally {
    if (previousKey == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test('rechaza campos anidados fuera de política aunque el proveedor responda 200', async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key-never-sent';
  const unsafe = {
    ...modelOutput,
    priorities: [{
      ...modelOutput.priorities[0],
      area: 'PAGOS',
      urgency: 'NOW',
      evidence: 'sin evidencia',
      recommendedAction: 'Pagar ahora',
      requiresHumanApproval: false,
    }],
  };
  const mockFetch: typeof fetch = async () => new Response(JSON.stringify({
    id: 'resp_unsafe',
    status: 'completed',
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(unsafe) }] }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  try {
    await assert.rejects(() => generateGeneralManagerBrief(snapshot, '', mockFetch), /inválida/);
  } finally {
    if (previousKey == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});
