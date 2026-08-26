import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { deriveAuditSummary, deriveCompanyOsGlobalState } from '../components/company-os-dashboard';
import { CompanyOsRuntimeControlCenter, flattenRuntimeAgentHierarchy, normalizeRuntimeControlCenterSnapshot } from '../components/company-os-runtime-control-center';
import { buildSystemsSnapshot, SYSTEMS_OBSERVATION_MODES } from '../lib/company-os/systems-snapshot';

type DashboardCases = Parameters<typeof deriveCompanyOsGlobalState>[0];

function companyCase(input: { status?:string; heartbeat?:string; event?:string; mission?:string; workerHealth?:string; updatedAt?:string }) {
  return {
    id:'case-1', requestId:crypto.randomUUID(), agentId:'systems-manager-ai-v1', area:'SYSTEMS', caseType:'TECHNICAL_ADVISORY', objective:'test',
    status:input.status??'COMPLETED', webhookDeliveryStatus:'DELIVERED', createdAt:'2026-08-16T12:00:00.000Z', updatedAt:input.updatedAt??'2026-08-16T12:01:00.000Z',
    messages:[], usage:[], heartbeats:input.heartbeat?[{createdAt:input.heartbeat,phase:'RUNNING'}]:[],
    events:input.event?[{id:'event-1',sequence:1,eventType:input.event,createdAt:'2026-08-16T12:01:00.000Z'}]:[],
    auditEvents:[{id:'audit-1',action:'ANALYSIS_COMPLETED',metadata:{businessWrites:0,infrastructureWrites:0},createdAt:'2026-08-16T12:01:00.000Z'}],
    missions:input.mission?[{id:'mission-1',title:'Misión',rationale:'Prueba',expectedOutput:'Informe',status:input.mission}]:[],
    evidence:[{evidenceKey:'assets',value:[{assetId:'company-os-worker',name:'Worker',provider:'Hostinger',category:'SERVER_WORKER',environment:'production',lifecycleStatus:'ACTIVE',healthStatus:input.workerHealth??'HEALTHY',criticality:'CRITICAL',coverageStatus:'CONFIRMED',observationMode:'LIVE_OBSERVED',observationLabel:'Health HTTP',warnings:[]}]}],
  } as DashboardCases[number];
}

test('snapshot distingue las cuatro procedencias y no declara Vercel saludable', async () => {
  const originalFetch=global.fetch; const originalUrl=process.env.COMPANY_OS_V3_WORKER_URL;
  process.env.COMPANY_OS_V3_WORKER_URL='https://worker.example.test';
  global.fetch=async()=>new Response(JSON.stringify({ok:true,service:'company-os-v3-worker',contract:'systems-manager-ai-v1'}),{status:200,headers:{'content-type':'application/json'}});
  try {
    const snapshot=await buildSystemsSnapshot();
    assert.deepEqual(SYSTEMS_OBSERVATION_MODES,['LIVE_OBSERVED','DECLARED_FROM_CONFIG','INFERRED','UNOBSERVED']);
    assert.deepEqual(new Set(snapshot.assets.map((asset)=>asset.observationMode)),new Set(SYSTEMS_OBSERVATION_MODES));
    const vercel=snapshot.assets.find((asset)=>asset.assetId==='company-os-webapp');
    assert.equal(vercel?.observationMode,'DECLARED_FROM_CONFIG'); assert.equal(vercel?.healthStatus,'UNKNOWN');
    assert.match(vercel?.observationLabel??'',/sin health check independiente/i);
    assert.equal(vercel?.maxSourceUpdatedAt,null); assert.equal(vercel?.freshnessStatus,'UNKNOWN');
    const database=snapshot.assets.find((asset)=>asset.assetId==='company-os-database');
    assert.equal(database?.observationMode,'LIVE_OBSERVED'); assert.match(database?.observationLabel??'',/transacción PostgreSQL actual/i);
    assert.ok(database?.maxSourceUpdatedAt); assert.equal(database?.freshnessStatus,'CURRENT');
    assert.equal(snapshot.coverage.observed.includes('Vercel runtime metadata'),false);
    assert.equal(snapshot.assets.some((asset)=>asset.assetId==='openclaw-gateway'),false);
    assert.equal(snapshot.dependencies.some((dependency)=>dependency.dependencyId==='dep-worker-telegram'),true);
  } finally { global.fetch=originalFetch; if(originalUrl===undefined)delete process.env.COMPANY_OS_V3_WORKER_URL;else process.env.COMPANY_OS_V3_WORKER_URL=originalUrl; }
});

test('estado global deriva IDLE, WORKING, WAITING, DEGRADED y OFFLINE', () => {
  const now=Date.parse('2026-08-16T12:10:00.000Z');
  assert.equal(deriveCompanyOsGlobalState([],now).state,'IDLE');
  assert.equal(deriveCompanyOsGlobalState([companyCase({status:'ANALYZING',heartbeat:'2026-08-16T12:09:00.000Z'})],now).state,'WORKING');
  assert.equal(deriveCompanyOsGlobalState([companyCase({status:'AWAITING_REVIEW',mission:'PLANNED'})],now).state,'WAITING_FOR_DIEGO');
  assert.equal(deriveCompanyOsGlobalState([companyCase({status:'ANALYZING',heartbeat:'2026-08-16T12:03:00.000Z'})],now).state,'DEGRADED');
  assert.equal(deriveCompanyOsGlobalState([companyCase({status:'ANALYZING',heartbeat:'2026-08-16T11:50:00.000Z'})],now).state,'OFFLINE');
  assert.equal(deriveCompanyOsGlobalState([companyCase({status:'ANALYZING',updatedAt:'2026-08-16T11:50:00.000Z'})],now).state,'OFFLINE');
  assert.equal(deriveCompanyOsGlobalState([
    companyCase({status:'ANALYZING',updatedAt:'2026-08-16T12:09:00.000Z'}),
    companyCase({status:'COMPLETED',heartbeat:'2026-08-16T11:00:00.000Z'}),
  ],now).state,'WORKING');
  assert.equal(deriveCompanyOsGlobalState([companyCase({status:'AWAITING_REVIEW',mission:'BLOCKED'})],now).state,'IDLE');
  assert.equal(deriveCompanyOsGlobalState([
    companyCase({status:'COMPLETED',event:'ANALYSIS_COMPLETED',updatedAt:'2026-08-16T12:05:00.000Z'}),
    companyCase({status:'FAILED',updatedAt:'2026-08-16T12:00:00.000Z'}),
  ],now).state,'IDLE');
});

test('centro runtime conserva UNKNOWN, UNOBSERVED y NOT_INSTALLED sin inferir OFFLINE', () => {
  const snapshot=normalizeRuntimeControlCenterSnapshot({
    generatedAt:'2026-08-25T23:00:00.000Z',
    runtime:{paused:false,globalConcurrency:2},
    workers:[
      {workerId:'worker-unknown',host:'Mac mini',state:'OFFLINE',currentWork:undefined},
      {workerId:'worker-stopped',host:'Mac mini',state:'STOPPED',currentWork:null},
    ],
    agents:[
      {agentId:'general-manager',name:'Gerente General',installationStatus:'INSTALLED',status:'IDLE'},
      {agentId:'procurement-manager',name:'Gerente de Compras',reportsToAgentId:'general-manager',installationStatus:'NOT_INSTALLED',status:'UNKNOWN'},
    ],
    queue:{queued:0,claimed:0,running:0,needsReview:0,blocked:0,failedRetryable:0,failedFinal:0},
    schedules:[],
    usage:{dailyTokens:0,dailyCostUsd:0,monthlyTokens:0,monthlyCostUsd:0,byAgentModel:[]},
    incidents:[],
    dependencies:[
      {key:'supabase',status:'HEALTHY',observedAt:null,latencyMs:null},
      {key:'worker-api',status:'HEALTHY',observedAt:'2026-08-25T22:59:59.000Z',latencyMs:12},
    ],
    messages:[],
  });
  assert.equal(snapshot.workers[0].state,'UNKNOWN');
  assert.equal(snapshot.workers[1].state,'STOPPED');
  assert.equal(snapshot.agents[1].installationStatus,'NOT_INSTALLED');
  assert.equal(snapshot.dependencies[0].status,'UNOBSERVED');
  assert.equal(snapshot.dependencies[1].status,'HEALTHY');
  assert.deepEqual(
    flattenRuntimeAgentHierarchy(snapshot.agents).map(({agent,depth})=>[agent.agentId,depth]),
    [['general-manager',0],['procurement-manager',1]],
  );
});

test('centro runtime usa polling de 15 segundos y controles humanos idempotentes', () => {
  const source=readFileSync('components/company-os-runtime-control-center.tsx','utf8');
  const dashboard=readFileSync('components/company-os-dashboard.tsx','utf8');
  assert.match(source,/\/api\/company-os\/runtime\/v1\/control-center/);
  assert.match(source,/\/api\/company-os\/runtime\/v1\/control/);
  assert.match(source,/POLL_INTERVAL_MS = 15_000/);
  assert.match(source,/"PAUSE" \| "RESUME" \| "RETRY_CASE"/);
  assert.match(source,/idempotencyKey: `ui:\$\{crypto\.randomUUID\(\)\}`/);
  assert.match(source,/observation === "OBSERVED"/);
  assert.doesNotMatch(source,/workerStates[\s\S]*"OFFLINE"/);
  assert.match(dashboard,/CompanyOsRuntimeControlCenter/);
});

test('centro runtime inicia sin convertir telemetría ausente en estado operativo', () => {
  const markup=renderToStaticMarkup(createElement(CompanyOsRuntimeControlCenter));
  assert.match(markup,/Centro de Control runtime/);
  assert.match(markup,/API LOADING/);
  assert.match(markup,/Runtime UNKNOWN/);
  assert.match(markup,/No hay workers observados/);
  assert.match(markup,/Schedules UNOBSERVED/);
  assert.match(markup,/Incidentes UNOBSERVED/);
  assert.match(markup,/Mensajes UNOBSERVED/);
  assert.doesNotMatch(markup,/Runtime ENABLED/);
});

test('auditoría visible se deriva de eventos y estados, no de texto constante', () => {
  const clean=[companyCase({event:'ANALYSIS_COMPLETED',mission:'APPROVED'})];
  assert.deepEqual(deriveAuditSummary(clean),{events:1,executionStates:0,advisoryOnly:true,auditEvents:1,businessWrites:0,infrastructureWrites:0,auditCoverageComplete:true});
  assert.equal(deriveAuditSummary([{...clean[0],events:[...clean[0].events,{id:'event-2',sequence:2,eventType:'MISSION_DECIDED',createdAt:'2026-08-16T12:02:00.000Z'}]}]).auditCoverageComplete,false);
  assert.equal(deriveAuditSummary([companyCase({mission:'RUNNING'})]).advisoryOnly,false);
  const source=readFileSync('components/company-os-dashboard.tsx','utf8');
  assert.doesNotMatch(source,/window\.prompt/); assert.doesNotMatch(source,/Contrato: 0 escrituras empresariales/);
  assert.match(source,/45_000/); assert.match(source,/type="datetime-local"/); assert.match(source,/Motivo obligatorio/); assert.match(source,/max-h-\[90dvh\]/);
  assert.match(source,/"Resumen"\s*,\s*"Inbox"\s*,\s*"Caso"\s*,\s*"Sistemas"/); assert.match(source,/<details/); assert.match(source,/Score \$\{risk\.priority\}/);
  assert.match(source,/names\.get\(item\.sourceAssetId\)/);
  assert.match(source,/setAllCases\(received\)/); assert.match(source,/deriveCompanyOsGlobalState\(sourceCases\)/);
  assert.doesNotMatch(source,/Cero escrituras verificadas por auditoría/);
  assert.match(source,/Auditoría interna sin escrituras declaradas/);
  const storeSource=readFileSync('lib/company-os/v3-store.ts','utf8');
  assert.match(storeSource,/auditsByRequest/); assert.match(storeSource,/auditEvents:/);
});
