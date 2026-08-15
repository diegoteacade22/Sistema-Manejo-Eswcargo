import { createHash } from 'node:crypto';
import { COMPANY_OS_EVIDENCE_KEYS } from './types';
import type { CompanyBrief, CompanyEvidenceKey, CompanyPriority, CompanySnapshot, ModelBrief } from './types';

const DEFAULT_MODEL = 'gpt-5.6';
const AREAS = new Set(['GERENCIA_GENERAL', 'DATA_QUALITY', 'FINANZAS', 'COMPRAS', 'COMERCIAL', 'LOGISTICA', 'TECNOLOGIA']);
const SPECIALIST_AREAS = new Set(['DATA_QUALITY', 'FINANZAS', 'COMPRAS', 'COMERCIAL', 'LOGISTICA', 'TECNOLOGIA']);
const URGENCIES = new Set(['P0', 'P1', 'P2']);
const PROHIBITED_DIRECT_ACTION = /\b(autorizar|autoriza|aprobar|aprueba|transferir|transferencia|pagar|comprar|vender|cobrar|contactar|responder|mandar|enviar|publicar|desplegar|eliminar|borrar|aplicar pago|ejecutar pago|ejecutar compra|modificar (precio|saldo|estado)|cambiar (precio|saldo|estado))\b/i;
const SERVER_GUARDRAILS = [
  'Solo lectura sobre datos empresariales',
  'Sin pagos ni compras',
  'Sin mensajes externos',
  'Sin cambios de precio, saldo o estado',
  'Sin despliegues, secretos ni permisos',
];
const SERVER_COVERAGE = ['Pedidos', 'Productos', 'Compras', 'Envíos', 'Gastos', 'SyncRun operativo'];
const SYSTEM_INSTRUCTIONS = [
  'Eres el Gerente General AI read-only de ESWTECH/ESWCARGO.',
  'Tu misión es reducir carga del CEO: prioriza un máximo de cinco decisiones y delega análisis a las áreas especializadas.',
  'Usa exclusivamente el snapshot provisto. No inventes nombres, saldos, estados ni causas.',
  'Cada prioridad debe usar evidenceRefs válidos; el servidor materializa esas referencias desde el snapshot y no acepta evidencia libre.',
  'Nunca autorices compras, pagos, cambios de precio/estado, mensajes, despliegues ni escrituras.',
  'Si la fuente está desactualizada, incompleta o contradictoria, decláralo y prioriza Data Quality.',
  'No repitas datos identificadores ni secretos que pudieran aparecer redactados en el objetivo.',
  'Responde en español, concreto y ejecutivo.',
].join('\n');

const BRIEF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    schemaVersion: { type: 'string', enum: ['1'] },
    executiveSummary: { type: 'string' },
    priorities: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          area: {
            type: 'string',
            enum: ['GERENCIA_GENERAL', 'DATA_QUALITY', 'FINANZAS', 'COMPRAS', 'COMERCIAL', 'LOGISTICA', 'TECNOLOGIA'],
          },
          urgency: { type: 'string', enum: ['P0', 'P1', 'P2'] },
          evidenceRefs: { type: 'array', minItems: 1, items: { type: 'string', enum: COMPANY_OS_EVIDENCE_KEYS } },
          recommendedAction: { type: 'string' },
          owner: { type: 'string' },
          dueWindow: { type: 'string' },
          requiresHumanApproval: { type: 'boolean' },
        },
        required: ['id', 'title', 'area', 'urgency', 'evidenceRefs', 'recommendedAction', 'owner', 'dueWindow', 'requiresHumanApproval'],
      },
    },
    delegations: {
      type: 'array',
      maxItems: 7,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          agent: { type: 'string', enum: ['DATA_QUALITY', 'FINANZAS', 'COMPRAS', 'COMERCIAL', 'LOGISTICA', 'TECNOLOGIA'] },
          mission: { type: 'string' },
          why: { type: 'string' },
          expectedOutput: { type: 'string' },
        },
        required: ['agent', 'mission', 'why', 'expectedOutput'],
      },
    },
    dataQuality: {
      type: 'object',
      additionalProperties: false,
      properties: {
        gaps: { type: 'array', items: { type: 'string' } },
      },
      required: ['gaps'],
    },
  },
  required: ['schemaVersion', 'executiveSummary', 'priorities', 'delegations', 'dataQuality'],
} as const;

export function companyOsModel() {
  return (process.env.COMPANY_OS_MODEL ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL;
}

export function companyOsPolicyFingerprint() {
  return createHash('sha256')
    .update(JSON.stringify({ instructions: SYSTEM_INSTRUCTIONS, schema: BRIEF_SCHEMA }))
    .digest('hex');
}

type OpenAIResponse = {
  id?: string;
  status?: string;
  error?: { message?: string; type?: string } | null;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string; refusal?: string }>;
  }>;
};

function outputText(response: OpenAIResponse) {
  return (response.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === 'output_text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function stringArray(value: unknown, minimum = 0): value is string[] {
  return Array.isArray(value) && value.length >= minimum && value.every(nonEmptyString);
}

function validateModelBrief(value: unknown): asserts value is ModelBrief {
  if (!value || typeof value !== 'object') throw new Error('Respuesta AI sin objeto estructurado');
  const brief = value as Partial<ModelBrief>;
  if (brief.schemaVersion !== '1') throw new Error('Versión de brief AI inválida');
  if (typeof brief.executiveSummary !== 'string' || !brief.executiveSummary.trim()) throw new Error('Resumen ejecutivo AI vacío');
  if (!Array.isArray(brief.priorities) || brief.priorities.length > 5) throw new Error('Prioridades AI inválidas');
  if (!Array.isArray(brief.delegations) || brief.delegations.length > 7) throw new Error('Delegaciones AI inválidas');
  for (const priority of brief.priorities) {
    if (!priority || typeof priority !== 'object') throw new Error('Prioridad AI sin objeto');
    const item = priority as Partial<ModelBrief['priorities'][number]>;
    if (!nonEmptyString(item.id) || !nonEmptyString(item.title) || !AREAS.has(String(item.area)) || !URGENCIES.has(String(item.urgency))) {
      throw new Error('Prioridad AI con identidad, área o urgencia inválida');
    }
    if (!Array.isArray(item.evidenceRefs) || item.evidenceRefs.length < 1 || item.evidenceRefs.some((key) => !COMPANY_OS_EVIDENCE_KEYS.includes(key))) {
      throw new Error('Prioridad AI sin referencias de evidencia válidas');
    }
    if (!nonEmptyString(item.recommendedAction) || !nonEmptyString(item.owner) || !nonEmptyString(item.dueWindow)) {
      throw new Error('Prioridad AI incompleta');
    }
    if (typeof item.requiresHumanApproval !== 'boolean') throw new Error('Prioridad AI sin gate humano explícito');
    if (PROHIBITED_DIRECT_ACTION.test(item.recommendedAction)) throw new Error('Prioridad AI intentó autorizar una acción prohibida');
  }
  for (const delegation of brief.delegations) {
    if (!delegation || typeof delegation !== 'object') throw new Error('Delegación AI sin objeto');
    const item = delegation as Partial<ModelBrief['delegations'][number]>;
    if (!SPECIALIST_AREAS.has(String(item.agent)) || !nonEmptyString(item.mission) || !nonEmptyString(item.why) || !nonEmptyString(item.expectedOutput)) {
      throw new Error('Delegación AI inválida');
    }
    if (PROHIBITED_DIRECT_ACTION.test(item.mission)) throw new Error('Delegación AI intentó autorizar una acción prohibida');
  }
  if (!brief.dataQuality || !Array.isArray(brief.dataQuality.gaps)) {
    throw new Error('Calidad de datos AI inválida');
  }
  if (!stringArray(brief.dataQuality.gaps)) throw new Error('Brechas AI inválidas');
}

function snapshotEvidence(snapshot: CompanySnapshot, key: CompanyEvidenceKey) {
  const values: Record<CompanyEvidenceKey, string> = {
    ordersLast7Days: `${snapshot.metrics.ordersLast7Days} pedido(s) en los últimos 7 días`,
    revenueLast7DaysUsd: `USD ${snapshot.metrics.revenueLast7DaysUsd.toFixed(2)} facturados en los últimos 7 días`,
    ordersNonUsdLast7Days: `${snapshot.metrics.ordersNonUsdLast7Days} pedido(s) no expresados en USD en los últimos 7 días`,
    ordersToBuy: `${snapshot.metrics.ordersToBuy} pedido(s) requieren sourcing`,
    productsActive: `${snapshot.metrics.productsActive} producto(s) activos`,
    unitsInStock: `${snapshot.metrics.unitsInStock} unidad(es) en stock`,
    productsWithoutStock: `${snapshot.metrics.productsWithoutStock} producto(s) sin stock`,
    shipmentsInTransit: `${snapshot.metrics.shipmentsInTransit} envío(s) en tránsito`,
    delayedShipments: `${snapshot.metrics.delayedShipments} envío(s) en tránsito por más de 14 días`,
    purchasesPending: `${snapshot.metrics.purchasesPending} compra(s) pendientes`,
    purchasesBalanceUsd: `USD ${snapshot.metrics.purchasesBalanceUsd.toFixed(2)} de saldo pendiente de compras`,
    expensesLast30DaysUsd: `USD ${snapshot.metrics.expensesLast30DaysUsd.toFixed(2)} de gastos en los últimos 30 días`,
    latestOrderUpdate: `Última actualización de pedidos: ${snapshot.freshness.latestOrderUpdate ?? 'sin dato'}`,
    latestProductUpdate: `Última actualización de productos: ${snapshot.freshness.latestProductUpdate ?? 'sin dato'}`,
    latestShipmentUpdate: `Última actualización de envíos: ${snapshot.freshness.latestShipmentUpdate ?? 'sin dato'}`,
    latestSync: snapshot.freshness.latestSync
      ? `Último sync operativo: ${snapshot.freshness.latestSync.status}, ${snapshot.freshness.latestSync.ageHours} h`
      : 'No existe SyncRun operativo verificable',
  };
  return values[key];
}

function serverStatus(snapshot: CompanySnapshot, priorities: CompanyPriority[]): CompanyBrief['status'] {
  if (!snapshot.freshness.latestSync) return 'BLOCKED';
  if (!snapshot.freshness.latestSync.fresh || priorities.some((priority) => priority.urgency === 'P0')) return 'NEEDS_ATTENTION';
  return 'READY';
}

export function buildDeterministicFallback(snapshot: CompanySnapshot, warning: string): CompanyBrief {
  const priorities: CompanyPriority[] = [];
  const add = (priority: CompanyPriority) => {
    if (priorities.length < 5) priorities.push(priority);
  };

  if (!snapshot.freshness.latestSync || !snapshot.freshness.latestSync.fresh) {
    add({
      id: 'DATA-SYNC',
      title: 'Validar la última sincronización operativa',
      area: 'DATA_QUALITY',
      urgency: 'P0',
      evidence: [snapshot.freshness.latestSync ? `Último sync operativo: ${snapshot.freshness.latestSync.status}, ${snapshot.freshness.latestSync.ageHours} h` : 'No existe SyncRun operativo verificable'],
      recommendedAction: 'Revisar el último SyncRun y confirmar frescura antes de usar cifras para decisiones.',
      owner: 'Data Quality',
      dueWindow: 'Hoy',
      requiresHumanApproval: false,
    });
  }
  if (snapshot.metrics.delayedShipments > 0) {
    add({
      id: 'LOG-DELAY',
      title: 'Resolver envíos en tránsito con más de 14 días',
      area: 'LOGISTICA',
      urgency: 'P0',
      evidence: [`${snapshot.metrics.delayedShipments} envío(s) demorado(s)`],
      recommendedAction: 'Preparar lista de excepciones con evidencia y responsable, sin modificar estados automáticamente.',
      owner: 'Logística',
      dueWindow: '24 horas',
      requiresHumanApproval: true,
    });
  }
  if (snapshot.metrics.ordersToBuy > 0) {
    add({
      id: 'BUY-BACKLOG',
      title: 'Revisar pedidos pendientes de compra o reserva',
      area: 'COMPRAS',
      urgency: 'P1',
      evidence: [`${snapshot.metrics.ordersToBuy} pedido(s) requieren sourcing`],
      recommendedAction: 'Comparar disponibilidad y costo; elevar propuesta sin comprometer capital.',
      owner: 'Compras y Sourcing',
      dueWindow: '48 horas',
      requiresHumanApproval: true,
    });
  }
  if (snapshot.metrics.purchasesPending > 0) {
    add({
      id: 'FIN-PAYABLES',
      title: 'Priorizar saldos pendientes de compras',
      area: 'FINANZAS',
      urgency: 'P1',
      evidence: [`${snapshot.metrics.purchasesPending} compra(s) con USD ${snapshot.metrics.purchasesBalanceUsd.toFixed(2)} pendientes`],
      recommendedAction: 'Preparar conciliación y vencimientos; no ejecutar pagos.',
      owner: 'Finanzas',
      dueWindow: '48 horas',
      requiresHumanApproval: true,
    });
  }

  return {
    schemaVersion: '1',
    generatedAt: new Date().toISOString(),
    businessDate: snapshot.businessDate,
    status: 'NEEDS_ATTENTION',
    executiveSummary: 'El snapshot operativo está disponible, pero el modelo AI no respondió. Se muestran prioridades determinísticas y conservadoras.',
    priorities,
    delegations: priorities
      .filter((priority) => priority.area !== 'GERENCIA_GENERAL')
      .map((priority) => ({
        agent: priority.area as Exclude<typeof priority.area, 'GERENCIA_GENERAL'>,
        mission: priority.recommendedAction,
        why: priority.evidence.join('; '),
        expectedOutput: 'Informe read-only con evidencia, owner y próximo gate.',
      })),
    dataQuality: {
      cutoff: snapshot.generatedAt,
      coverage: ['Pedidos', 'Productos', 'Compras', 'Envíos', 'Gastos', 'SyncRun'],
      gaps: ['No se obtuvo síntesis del modelo OpenAI'],
    },
    guardrails: SERVER_GUARDRAILS,
    execution: {
      provider: 'deterministic-fallback',
      model: 'none',
      responseId: null,
      snapshotId: snapshot.snapshotId,
      businessDataReadOnly: true,
      auditWrite: 'CompanyAgentRun',
      auditRunId: null,
    },
    warnings: [warning],
  };
}

export async function generateGeneralManagerBrief(
  snapshot: CompanySnapshot,
  objective = '',
  fetcher: typeof fetch = fetch,
): Promise<CompanyBrief> {
  const apiKey = (process.env.OPENAI_API_KEY ?? '').trim();
  if (!apiKey) return buildDeterministicFallback(snapshot, 'OPENAI_API_KEY no configurada');

  const model = companyOsModel();
  const response = await fetcher('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      store: false,
      reasoning: { effort: 'low' },
      max_output_tokens: 2400,
      metadata: { system: 'esw-company-os', version: '1' },
      instructions: SYSTEM_INSTRUCTIONS,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: JSON.stringify({
                objective: objective.trim() || 'Emitir el brief ejecutivo actual y organizar los próximos frentes.',
                snapshot,
                specialistAreas: ['DATA_QUALITY', 'FINANZAS', 'COMPRAS', 'COMERCIAL', 'LOGISTICA', 'TECNOLOGIA'],
              }),
            },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'company_os_executive_brief',
          strict: true,
          schema: BRIEF_SCHEMA,
        },
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });

  const payload = (await response.json()) as OpenAIResponse;
  if (!response.ok) {
    const detail = payload.error?.type || payload.error?.message || `HTTP ${response.status}`;
    throw new Error(`OpenAI Responses API: ${detail}`);
  }

  if (payload.status !== 'completed') throw new Error(`OpenAI Responses API incompleta (status=${payload.status ?? 'unknown'})`);
  if (!nonEmptyString(payload.id) || !payload.id.startsWith('resp_')) throw new Error('OpenAI Responses API sin responseId verificable');
  const refusal = (payload.output ?? []).flatMap((item) => item.content ?? []).find((part) => part.type === 'refusal');
  if (refusal) throw new Error('OpenAI Responses API rechazó el brief');

  const text = outputText(payload);
  if (!text) throw new Error(`OpenAI Responses API sin output_text (status=${payload.status ?? 'unknown'})`);
  const modelBrief = JSON.parse(text) as unknown;
  validateModelBrief(modelBrief);

  const priorities: CompanyPriority[] = modelBrief.priorities.map(({ evidenceRefs, ...priority }) => ({
    ...priority,
    evidence: evidenceRefs.map((key) => snapshotEvidence(snapshot, key)),
  }));

  return {
    schemaVersion: modelBrief.schemaVersion,
    status: serverStatus(snapshot, priorities),
    executiveSummary: modelBrief.executiveSummary,
    priorities,
    delegations: modelBrief.delegations,
    generatedAt: new Date().toISOString(),
    businessDate: snapshot.businessDate,
    dataQuality: {
      cutoff: snapshot.generatedAt,
      coverage: SERVER_COVERAGE,
      gaps: modelBrief.dataQuality.gaps,
    },
    guardrails: SERVER_GUARDRAILS,
    execution: {
      provider: 'openai',
      model,
      responseId: payload.id ?? null,
      snapshotId: snapshot.snapshotId,
      businessDataReadOnly: true,
      auditWrite: 'CompanyAgentRun',
      auditRunId: null,
    },
    warnings: [],
  };
}
