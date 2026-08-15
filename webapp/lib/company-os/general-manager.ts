import { createHash } from 'node:crypto';
import { COMPANY_OS_EVIDENCE_KEYS } from './types';
import type { CompanyBrief, CompanyEvidenceKey, CompanyPriority, CompanySnapshot, ModelBrief } from './types';

const DEFAULT_MODEL = 'gpt-5.6';
const AREAS = new Set(['GERENCIA_GENERAL', 'DATA_QUALITY', 'FINANZAS', 'COMPRAS', 'COMERCIAL', 'LOGISTICA', 'TECNOLOGIA']);
const URGENCIES = new Set(['P0', 'P1', 'P2']);
const ACTION_TYPES = new Set(['REVIEW', 'ANALYZE', 'PREPARE_REPORT', 'ESCALATE_FOR_HUMAN_DECISION']);
const DUE_WINDOWS = new Set(['TODAY', '24_HOURS', '48_HOURS', '7_DAYS']);
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
  'Tu misión es reducir carga del CEO: selecciona un máximo de cinco focos usando exclusivamente los enums permitidos.',
  'Usa exclusivamente el snapshot provisto. No inventes nombres, saldos, estados ni causas.',
  'Cada prioridad debe usar evidenceRefs, actionType y dueWindow válidos; el servidor materializa todo texto operativo.',
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
    priorities: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          area: {
            type: 'string',
            enum: ['GERENCIA_GENERAL', 'DATA_QUALITY', 'FINANZAS', 'COMPRAS', 'COMERCIAL', 'LOGISTICA', 'TECNOLOGIA'],
          },
          urgency: { type: 'string', enum: ['P0', 'P1', 'P2'] },
          evidenceRefs: { type: 'array', minItems: 1, items: { type: 'string', enum: COMPANY_OS_EVIDENCE_KEYS } },
          actionType: { type: 'string', enum: ['REVIEW', 'ANALYZE', 'PREPARE_REPORT', 'ESCALATE_FOR_HUMAN_DECISION'] },
          dueWindow: { type: 'string', enum: ['TODAY', '24_HOURS', '48_HOURS', '7_DAYS'] },
        },
        required: ['id', 'area', 'urgency', 'evidenceRefs', 'actionType', 'dueWindow'],
      },
    },
  },
  required: ['schemaVersion', 'priorities'],
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

function hasOnlyKeys(value: object, allowed: string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function validateModelBrief(value: unknown): asserts value is ModelBrief {
  if (!value || typeof value !== 'object') throw new Error('Respuesta AI sin objeto estructurado');
  const brief = value as Partial<ModelBrief>;
  if (!hasOnlyKeys(value, ['schemaVersion', 'priorities'])) throw new Error('Respuesta AI contiene campos no permitidos');
  if (brief.schemaVersion !== '1') throw new Error('Versión de brief AI inválida');
  if (!Array.isArray(brief.priorities) || brief.priorities.length > 5) throw new Error('Prioridades AI inválidas');
  for (const priority of brief.priorities) {
    if (!priority || typeof priority !== 'object') throw new Error('Prioridad AI sin objeto');
    const item = priority as Partial<ModelBrief['priorities'][number]>;
    if (!hasOnlyKeys(priority, ['id', 'area', 'urgency', 'evidenceRefs', 'actionType', 'dueWindow'])) {
      throw new Error('Prioridad AI contiene campos no permitidos');
    }
    if (!nonEmptyString(item.id) || !/^[A-Z0-9_-]{1,40}$/.test(item.id) || !AREAS.has(String(item.area)) || !URGENCIES.has(String(item.urgency))) {
      throw new Error('Prioridad AI con identidad, área o urgencia inválida');
    }
    if (!Array.isArray(item.evidenceRefs) || item.evidenceRefs.length < 1 || item.evidenceRefs.some((key) => !COMPANY_OS_EVIDENCE_KEYS.includes(key))) {
      throw new Error('Prioridad AI sin referencias de evidencia válidas');
    }
    if (!ACTION_TYPES.has(String(item.actionType)) || !DUE_WINDOWS.has(String(item.dueWindow))) throw new Error('Prioridad AI con acción o plazo no permitido');
  }
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

function serverStatus(snapshot: CompanySnapshot): CompanyBrief['status'] {
  if (!snapshot.freshness.latestSync) return 'BLOCKED';
  if (
    !snapshot.freshness.latestSync.fresh
    || snapshot.metrics.delayedShipments > 0
    || snapshot.metrics.ordersToBuy > 0
    || snapshot.metrics.purchasesPending > 0
    || snapshot.metrics.productsWithoutStock > 0
    || snapshot.metrics.ordersNonUsdLast7Days > 0
    || !snapshot.freshness.latestOrderUpdate
    || !snapshot.freshness.latestProductUpdate
    || !snapshot.freshness.latestShipmentUpdate
  ) return 'NEEDS_ATTENTION';
  return 'READY';
}

function dataGaps(snapshot: CompanySnapshot) {
  const gaps: string[] = [];
  if (!snapshot.freshness.latestSync) gaps.push('No existe SyncRun operativo verificable');
  else if (!snapshot.freshness.latestSync.fresh) gaps.push(`El último SyncRun operativo tiene ${snapshot.freshness.latestSync.ageHours} h`);
  if (!snapshot.freshness.latestOrderUpdate) gaps.push('Sin fecha de actualización de pedidos');
  if (!snapshot.freshness.latestProductUpdate) gaps.push('Sin fecha de actualización de productos');
  if (!snapshot.freshness.latestShipmentUpdate) gaps.push('Sin fecha de actualización de envíos');
  if (snapshot.metrics.ordersNonUsdLast7Days > 0) gaps.push(`${snapshot.metrics.ordersNonUsdLast7Days} pedido(s) recientes no están expresados en USD`);
  return gaps;
}

function executiveSummary(snapshot: CompanySnapshot, status: CompanyBrief['status'], priorityCount: number) {
  return `Estado ${status}. Snapshot ${snapshot.businessDate}: ${snapshot.metrics.ordersLast7Days} pedido(s) recientes, ${snapshot.metrics.delayedShipments} envío(s) demorado(s), ${snapshot.metrics.ordersToBuy} pedido(s) por abastecer y ${snapshot.metrics.purchasesPending} compra(s) pendiente(s). Se organizaron ${priorityCount} prioridad(es).`;
}

function modelPriority(snapshot: CompanySnapshot, item: ModelBrief['priorities'][number]): CompanyPriority {
  const labels: Record<CompanyEvidenceKey, string> = {
    ordersLast7Days: 'actividad reciente de pedidos',
    revenueLast7DaysUsd: 'facturación reciente en USD',
    ordersNonUsdLast7Days: 'pedidos recientes fuera de USD',
    ordersToBuy: 'pedidos que requieren abastecimiento',
    productsActive: 'catálogo activo',
    unitsInStock: 'unidades disponibles',
    productsWithoutStock: 'productos sin stock',
    shipmentsInTransit: 'envíos en tránsito',
    delayedShipments: 'envíos demorados',
    purchasesPending: 'compras pendientes',
    purchasesBalanceUsd: 'saldo pendiente de compras',
    expensesLast30DaysUsd: 'gastos recientes',
    latestOrderUpdate: 'frescura de pedidos',
    latestProductUpdate: 'frescura de productos',
    latestShipmentUpdate: 'frescura de envíos',
    latestSync: 'sincronización operativa',
  };
  const owners: Record<CompanyPriority['area'], string> = {
    GERENCIA_GENERAL: 'Gerencia General',
    DATA_QUALITY: 'Data Quality',
    FINANZAS: 'Finanzas',
    COMPRAS: 'Compras y Sourcing',
    COMERCIAL: 'Comercial',
    LOGISTICA: 'Logística',
    TECNOLOGIA: 'Tecnología',
  };
  const actions: Record<ModelBrief['priorities'][number]['actionType'], string> = {
    REVIEW: 'Revisar la evidencia del snapshot y documentar hallazgos, sin ejecutar cambios.',
    ANALYZE: 'Analizar la evidencia del snapshot y preparar conclusiones read-only.',
    PREPARE_REPORT: 'Preparar un informe read-only con evidencia, responsable sugerido y próximo gate.',
    ESCALATE_FOR_HUMAN_DECISION: 'Preparar una recomendación y elevarla a decisión humana, sin ejecutar la decisión.',
  };
  const dueWindows: Record<ModelBrief['priorities'][number]['dueWindow'], string> = {
    TODAY: 'Hoy',
    '24_HOURS': '24 horas',
    '48_HOURS': '48 horas',
    '7_DAYS': '7 días',
  };
  const primaryEvidence = item.evidenceRefs[0];
  return {
    id: item.id,
    title: `Revisar ${labels[primaryEvidence]}`,
    area: item.area,
    urgency: item.urgency,
    evidence: item.evidenceRefs.map((key) => snapshotEvidence(snapshot, key)),
    recommendedAction: actions[item.actionType],
    owner: owners[item.area],
    dueWindow: dueWindows[item.dueWindow],
    requiresHumanApproval: item.actionType === 'ESCALATE_FOR_HUMAN_DECISION'
      || ['FINANZAS', 'COMPRAS', 'COMERCIAL', 'LOGISTICA'].includes(item.area),
  };
}

function plannedDelegations(priorities: CompanyPriority[]) {
  return priorities
    .filter((priority) => priority.area !== 'GERENCIA_GENERAL')
    .map((priority) => ({
      agent: priority.area as Exclude<typeof priority.area, 'GERENCIA_GENERAL'>,
      mission: `Preparar análisis read-only para: ${priority.title}.`,
      why: priority.evidence.join('; '),
      expectedOutput: 'Informe read-only con evidencia, responsable sugerido y próximo gate.',
      status: 'PLANNED' as const,
    }));
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
  if (snapshot.metrics.productsWithoutStock > 0) {
    add({
      id: 'STOCK-GAPS',
      title: 'Revisar productos activos sin stock',
      area: 'COMPRAS',
      urgency: 'P1',
      evidence: [`${snapshot.metrics.productsWithoutStock} producto(s) sin stock`],
      recommendedAction: 'Preparar un informe read-only de brechas de inventario y elevar opciones a decisión humana.',
      owner: 'Compras y Sourcing',
      dueWindow: '48 horas',
      requiresHumanApproval: true,
    });
  }
  if (snapshot.metrics.ordersNonUsdLast7Days > 0) {
    add({
      id: 'CURRENCY-GAPS',
      title: 'Validar pedidos recientes fuera de USD',
      area: 'DATA_QUALITY',
      urgency: 'P1',
      evidence: [`${snapshot.metrics.ordersNonUsdLast7Days} pedido(s) recientes no están expresados en USD`],
      recommendedAction: 'Preparar un informe read-only de moneda y excluir esos importes de agregados USD.',
      owner: 'Data Quality',
      dueWindow: '48 horas',
      requiresHumanApproval: false,
    });
  }

  return {
    schemaVersion: '1',
    generatedAt: new Date().toISOString(),
    businessDate: snapshot.businessDate,
    status: serverStatus(snapshot),
    executiveSummary: 'El snapshot operativo está disponible, pero el modelo AI no respondió. Se muestran prioridades determinísticas y conservadoras.',
    priorities,
    delegations: plannedDelegations(priorities),
    dataQuality: {
      cutoff: snapshot.generatedAt,
      coverage: ['Pedidos', 'Productos', 'Compras', 'Envíos', 'Gastos', 'SyncRun'],
      gaps: [...dataGaps(snapshot), 'No se obtuvo síntesis del modelo OpenAI'],
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

  const required = buildDeterministicFallback(snapshot, '').priorities;
  const requiredEvidence = new Set<CompanyEvidenceKey>();
  if (!snapshot.freshness.latestSync || !snapshot.freshness.latestSync.fresh) requiredEvidence.add('latestSync');
  if (snapshot.metrics.delayedShipments > 0) requiredEvidence.add('delayedShipments');
  if (snapshot.metrics.ordersToBuy > 0) requiredEvidence.add('ordersToBuy');
  if (snapshot.metrics.purchasesPending > 0) requiredEvidence.add('purchasesPending');
  if (snapshot.metrics.productsWithoutStock > 0) requiredEvidence.add('productsWithoutStock');
  if (snapshot.metrics.ordersNonUsdLast7Days > 0) requiredEvidence.add('ordersNonUsdLast7Days');
  const modelPriorities = modelBrief.priorities
    .filter((item) => !item.evidenceRefs.some((key) => requiredEvidence.has(key)))
    .map((item) => modelPriority(snapshot, item));
  const priorities = [...required, ...modelPriorities].slice(0, 5);
  const status = serverStatus(snapshot);

  return {
    schemaVersion: modelBrief.schemaVersion,
    status,
    executiveSummary: executiveSummary(snapshot, status, priorities.length),
    priorities,
    delegations: plannedDelegations(priorities),
    generatedAt: new Date().toISOString(),
    businessDate: snapshot.businessDate,
    dataQuality: {
      cutoff: snapshot.generatedAt,
      coverage: SERVER_COVERAGE,
      gaps: dataGaps(snapshot),
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
