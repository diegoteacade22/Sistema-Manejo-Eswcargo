import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ContinuousObjectiveCard, CompanyOsContinuousObjectives, objectiveTaskProgress, parseContinuousObjectivesSnapshot,
  type ContinuousObjectiveDisplay,
} from '../components/company-os-continuous-objectives';
import { CONTINUOUS_OBJECTIVE_MAX_BODY_BYTES, parseContinuousObjectiveRequest, readContinuousObjectiveJson } from '../lib/company-os/continuous-objectives-http';

const createInput = {
  action:'CREATE', title:'Calidad de datos', objective:'Revisar fuentes y documentar los resultados.', durationDays:30,
  projectAllowlist:['SISTEMA ESWCARGO'], externalSources:[], criteria:['Cada análisis conserva evidencia.'], idempotencyKey:'objectives:00000000-0000-4000-8000-000000000001',
};
const fixture: ContinuousObjectiveDisplay = {
  id:'objective-1',version:1,controlRevision:0,title:'Calidad de datos',objective:'Revisar fuentes y documentar resultados.',status:'ACTIVE',
  startsAt:'2026-09-03T01:00:00Z',endsAt:'2026-10-03T01:00:00Z',projectAllowlist:['SISTEMA ESWCARGO'],externalSources:[],criteria:['Cada análisis conserva evidencia.'],
  scanIntervalMinutes:60,nextScanAt:'2026-09-03T02:00:00Z',createdBy:'admin',createdAt:'2026-09-03T01:00:00Z',updatedAt:'2026-09-03T01:00:00Z',
  lastScanAt:'2026-09-03T01:00:00Z',sourcesObserved:1,sourcesExcluded:0,
  counts:{planned:0,queued:0,analyzed:0,verified:1,needsReview:0,blocked:0,skipped:0},
  units:[{
    id:'unit-1',goalId:'objective-1',version:1,sourceId:'source-1',fingerprint:'f'.repeat(64),caseId:'case-1',status:'VERIFIED',ownerAgentId:'data-manager-ai-v1',priority:50,
    source:{kind:'DATA_BASELINE',projectName:'SISTEMA ESWCARGO',title:'Revisión de cobertura',authority:'LIVE_SNAPSHOT_REQUIRED',verificationScope:'ANALYSIS_ONLY'},
    resultSummary:'Análisis cerrado con fuente observada.',resultEvidence:['case:case-1','evidence:quality'],sourceResolved:false,verificationScope:'ANALYSIS_ONLY',createdAt:'2026-09-03T01:00:00Z',updatedAt:'2026-09-03T01:01:00Z',
  }],
};

test('objetivo HTTP conserva duración estable y rechaza presupuestos o campos extra', () => {
  assert.deepEqual(parseContinuousObjectiveRequest(createInput),createInput);
  for (const durationDays of [0,31,1.5,'30']) assert.throws(()=>parseContinuousObjectiveRequest({...createInput,durationDays}),/1 a 30/);
  assert.throws(()=>parseContinuousObjectiveRequest({...createInput,budgetUsd:100}),/campos no permitidos/);
  assert.deepEqual(parseContinuousObjectiveRequest({...createInput,projectAllowlist:[],externalSources:['GOOGLE_DRIVE']}).projectAllowlist,[]);
  assert.throws(()=>parseContinuousObjectiveRequest({...createInput,projectAllowlist:[],externalSources:[]}),/alcance|fuente/i);
  assert.throws(()=>parseContinuousObjectiveRequest({...createInput,criteria:['uno','uno']}),/repetidos/);
  assert.throws(()=>parseContinuousObjectiveRequest({...createInput,idempotencyKey:undefined}),/Clave/);
});

test('pausa y reanudación requieren versión, revisión de control y clave idempotente', () => {
  const input={action:'PAUSE',objectiveId:'objective-1',expectedVersion:1,expectedControlRevision:0,idempotencyKey:createInput.idempotencyKey};
  assert.deepEqual(parseContinuousObjectiveRequest(input),input);
  assert.deepEqual(parseContinuousObjectiveRequest({...input,action:'RESUME'}),{...input,action:'RESUME'});
  assert.throws(()=>parseContinuousObjectiveRequest({...input,expectedControlRevision:undefined}),/revisión/);
  assert.throws(()=>parseContinuousObjectiveRequest({...input,expectedVersion:0}),/versión/);
});

test('cuerpo HTTP exige JSON y limita bytes aun sin Content-Length', async () => {
  const request=(body:string,headers:Record<string,string>={})=>new Request('https://company.example.test/api/company-os/objectives',{method:'POST',headers:{'content-type':'application/json',...headers},body});
  assert.deepEqual(await readContinuousObjectiveJson(request(JSON.stringify(createInput))),createInput);
  await assert.rejects(readContinuousObjectiveJson(request('{}',{'content-type':'text/plain'})),(error:unknown)=>(error as {status:number}).status===415);
  await assert.rejects(readContinuousObjectiveJson(request('{broken')),(error:unknown)=>(error as {status:number}).status===400);
  await assert.rejects(readContinuousObjectiveJson(request('a'.repeat(CONTINUOUS_OBJECTIVE_MAX_BODY_BYTES+1))),(error:unknown)=>(error as {status:number}).status===413);
  await assert.rejects(readContinuousObjectiveJson(request('{}',{'content-length':String(CONTINUOUS_OBJECTIVE_MAX_BODY_BYTES+1)})),(error:unknown)=>(error as {status:number}).status===413);
});

test('análisis verificado muestra evidencia sin declarar la meta cumplida ni resolver el origen', () => {
  const html=renderToStaticMarkup(createElement(ContinuousObjectiveCard,{objective:fixture,pausing:true}));
  assert.match(html,/Análisis con evidencia/);
  assert.match(html,/evidence:quality/);
  assert.match(html,/El cierre de la meta requiere comprobar sus criterios/);
  assert.match(html,/Los análisis no cierran la tarea de origen/);
  assert.match(html,/Una tarea que ya está corriendo puede terminar/);
  assert.match(html,/Confirmar pausa/);
  assert.doesNotMatch(html,/100%|Meta cumplida|Objetivo completado/);
  assert.deepEqual(objectiveTaskProgress(fixture),{verified:1,analyzed:0,pending:0,skipped:0});
});

test('un barrido aún no observado no presenta cero fuentes como lectura real', () => {
  const html=renderToStaticMarkup(createElement(ContinuousObjectiveCard,{objective:{...fixture,lastScanAt:null,sourcesObserved:0,units:[]}}));
  assert.match(html,/>—<\/p><p[^>]*>Fuentes observadas/);
});

test('snapshots incompletos fallan sin convertir datos ausentes en progreso', () => {
  assert.deepEqual(parseContinuousObjectivesSnapshot({objectives:[fixture],allowedProjects:['SISTEMA ESWCARGO']}).objectives,[fixture]);
  assert.throws(()=>parseContinuousObjectivesSnapshot({objectives:[{...fixture,counts:undefined}],allowedProjects:[]}),/estado o resultados/);
  assert.throws(()=>parseContinuousObjectivesSnapshot({objectives:[{...fixture,units:[{...fixture.units[0],sourceResolved:true}]}],allowedProjects:[]}),/alcance/);
});

test('fuentes externas quedan visibles como alcance preparado y bloqueado', () => {
  const external = {...fixture, projectAllowlist:[], externalSources:['GOOGLE_DRIVE' as const], units:[]};
  const html=renderToStaticMarkup(createElement(ContinuousObjectiveCard,{objective:external}));
  assert.match(html,/Google Drive/);
  assert.match(html,/bloqueadas y auditadas/);
  assert.deepEqual(parseContinuousObjectivesSnapshot({objectives:[external],allowedProjects:[],externalSources:[{id:'GOOGLE_DRIVE',label:'Google Drive',status:'BLOCKED_REQUIRES_RUNTIME_CONNECTOR',note:'La conexión existe en la sesión de trabajo, pero todavía no está disponible para el runtime independiente.'}]}).objectives,[external]);
});

test('formulario inicia en 30 días y muestra controles sólo tras observar proyectos permitidos', () => {
  const html=renderToStaticMarkup(createElement(CompanyOsContinuousObjectives));
  assert.match(html,/max="30"/);
  assert.match(html,/value="30"/);
  assert.match(html,/Crear y activar/);
  assert.match(html,/48.000 tokens diarios/);
  assert.match(html,/Cargando proyectos del servidor/);
});

test('entrada visible en ambas páginas y API usa ADMIN, origen y readback sin cache', () => {
  const dashboard=readFileSync('components/company-os-dashboard.tsx','utf8');
  const operations=readFileSync('app/company-os/operations/page.tsx','utf8');
  const route=readFileSync('app/api/company-os/objectives/route.ts','utf8');
  const component=readFileSync('components/company-os-continuous-objectives.tsx','utf8');
  assert.match(dashboard,/href="\/company-os\/objectives"/);
  assert.ok(operations.indexOf('href="/company-os/objectives"')<operations.indexOf('<details'));
  assert.match(route,/requireHumanCompanyAdmin\(request\)/);
  assert.match(route,/hasTrustedHumanRequestOrigin\(request\)/);
  assert.match(route,/readContinuousObjectiveJson\(request\)/);
  assert.match(route,/'Cache-Control': 'no-store'/);
  assert.match(component,/15_000/);
  assert.match(component,/const readback = await refresh\(\)/);
});
