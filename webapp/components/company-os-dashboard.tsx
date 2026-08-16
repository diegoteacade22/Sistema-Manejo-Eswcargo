'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Ban, BrainCircuit, CheckCircle2, Clock3, Database, GitBranch, Loader2, MessageSquarePlus, RefreshCw, Send, ServerCog, ShieldCheck, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';

type RequestStatus = 'QUEUED' | 'ANALYZING' | 'AWAITING_REVIEW' | 'BLOCKED' | 'FAILED' | 'CANCELLED' | 'COMPLETED';
type MissionStatus = 'PLANNED' | 'APPROVED' | 'REJECTED' | 'REVIEW' | 'BLOCKED' | 'RUNNING' | 'DONE';
type CaseSummary = {
  id: string; requestId: string; agentId: 'general-manager-ai-v3' | 'systems-manager-ai-v1'; area: string; caseType: string; objective: string; status: RequestStatus; relatedCaseId?: string | null;
  webhookDeliveryStatus: string; createdAt: string; updatedAt: string;
  messages: Array<{ id: string; role: string; kind: string; content: string; createdAt: string }>;
  missions: Array<{ id: string; title: string; rationale: string; expectedOutput: string; status: MissionStatus }>;
  usage: Array<{ inputTokens: number; cachedTokens: number; cacheWriteTokens: number; outputTokens: number; reasoningTokens: number; totalTokens: number; estimatedCostUsd: string; dailyTotalTokens: number; dailyCostUsd: string; alertLevel?: number | null; responseId?: string | null; durationMs?: number | null; retries?: number; snapshotBytes?: number | null; rulesApplied?: string[] }>;
  heartbeats: Array<{ createdAt: string; phase: string }>;
  events: Array<{ id: string; sequence: number; eventType: string; createdAt: string }>;
  evidence: Array<{ evidenceKey: string; value: unknown; observedAt?: string | null }>;
};

const activeStatuses = new Set<RequestStatus>(['QUEUED', 'ANALYZING']);
const statusColor: Record<RequestStatus, string> = {
  QUEUED: 'border-sky-500/40 text-sky-300', ANALYZING: 'border-violet-500/40 text-violet-300',
  AWAITING_REVIEW: 'border-amber-500/40 text-amber-300', BLOCKED: 'border-orange-500/40 text-orange-300',
  FAILED: 'border-red-500/40 text-red-300', CANCELLED: 'border-slate-500/40 text-slate-400', COMPLETED: 'border-emerald-500/40 text-emerald-300',
};

function resultContent(content: string) {
  try { return JSON.parse(content) as { summary?: string; primaryDataQualityProblem?: string; recommendedNextStep?: string; primaryConfirmedRisk?: string; primaryCoverageGap?: string; confirmedRiskNextStep?: string; coverageGapNextStep?: string; evidenceRefs?: string[] }; }
  catch { return { summary: content }; }
}

function SystemsEvidence({ companyCase, decideRisk }: { companyCase: CaseSummary; decideRisk: (riskId: string, decision: 'ACKNOWLEDGE'|'POSTPONE'|'MARK_INCORRECT'|'COMMENT') => Promise<void> }) {
  const [filters, setFilters] = useState({ company: 'Company OS', environment: '', provider: '', category: '', criticality: '', status: '' });
  const evidence = Object.fromEntries(companyCase.evidence.map((item) => [item.evidenceKey, item.value])) as {
    assets?: Array<{assetId:string;name:string;provider:string;category:string;environment:string;lifecycleStatus:string;healthStatus:string;criticality:string;coverageStatus:string;warnings:string[]}>;
    dependencies?: Array<{dependencyId:string;sourceAssetId:string;targetAssetId:string;dependencyType:string;criticality:string;inferenceStatus:string}>;
    risks?: Array<{riskId:string;title:string;classification:string;priority:number;description:string;recommendedAction:string;missingEvidence:string[]}>;
    metadata?: {coverage?: {observed:string[];unobserved:string[]}};
  };
  const assets = evidence.assets ?? [];
  const options = (key: 'environment'|'provider'|'category'|'criticality') => [...new Set(assets.map((asset) => asset[key]))].sort();
  const statusOptions = [...new Set(assets.flatMap((asset) => [asset.lifecycleStatus, asset.healthStatus, asset.coverageStatus]))].sort();
  const filteredAssets = assets.filter((asset) => filters.company === 'Company OS'
    && (!filters.environment || asset.environment === filters.environment)
    && (!filters.provider || asset.provider === filters.provider)
    && (!filters.category || asset.category === filters.category)
    && (!filters.criticality || asset.criticality === filters.criticality)
    && (!filters.status || [asset.lifecycleStatus, asset.healthStatus, asset.coverageStatus].includes(filters.status)));
  const filterControl = (key: keyof typeof filters, label: string, values: string[]) => <select aria-label={label} value={filters[key]} onChange={(event) => setFilters((current) => ({ ...current, [key]: event.target.value }))} className="rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-xs text-slate-200"><option value="">{label}: todos</option>{values.map((value) => <option key={value} value={value}>{value}</option>)}</select>;
  return <div className="space-y-5">
    <Card className="border-white/10 bg-slate-950/80 text-slate-100"><CardHeader><CardTitle className="flex gap-2"><Database className="text-cyan-300" />Inventario técnico · {filteredAssets.length}/{assets.length}</CardTitle><CardDescription className="text-slate-400">Filtros de cobertura técnica; no cambian el inventario persistido.</CardDescription></CardHeader><CardContent><div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3"><select aria-label="Filtrar por empresa" value={filters.company} onChange={(event) => setFilters((current) => ({ ...current, company: event.target.value }))} className="rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-xs text-slate-200"><option value="Company OS">Empresa: Company OS</option></select>{filterControl('environment','Entorno',options('environment'))}{filterControl('provider','Proveedor',options('provider'))}{filterControl('category','Categoría',options('category'))}{filterControl('criticality','Criticidad',options('criticality'))}{filterControl('status','Estado',statusOptions)}</div><div className="grid gap-3 md:grid-cols-2">{filteredAssets.map((asset) => <div key={asset.assetId} className="rounded-xl border border-white/10 p-3"><div className="flex justify-between gap-2"><div><p className="font-semibold">{asset.name}</p><p className="text-xs text-slate-500">{asset.provider} · {asset.category} · {asset.environment}</p></div><Badge variant="outline">{asset.criticality}</Badge></div><div className="mt-2 flex flex-wrap gap-1"><Badge variant="outline">{asset.lifecycleStatus}</Badge><Badge variant="outline">{asset.healthStatus}</Badge><Badge variant="outline">{asset.coverageStatus}</Badge></div>{asset.warnings.map((warning) => <p key={warning} className="mt-2 text-xs text-amber-300">{warning}</p>)}</div>)}</div></CardContent></Card>
    <Card className="border-white/10 bg-slate-950/80 text-slate-100"><CardHeader><CardTitle className="flex gap-2"><GitBranch className="text-violet-300" />Dependencias · {evidence.dependencies?.length ?? 0}</CardTitle></CardHeader><CardContent className="space-y-2">{evidence.dependencies?.map((item) => <div key={item.dependencyId} className="rounded-lg border border-white/10 p-3 text-xs"><span className="text-cyan-300">{item.sourceAssetId}</span> → <span className="text-violet-300">{item.targetAssetId}</span> · {item.dependencyType} · {item.criticality} · {item.inferenceStatus}</div>)}</CardContent></Card>
    <Card className="border-white/10 bg-slate-950/80 text-slate-100"><CardHeader><CardTitle className="flex gap-2"><TriangleAlert className="text-amber-300" />Riesgos por clasificación</CardTitle><CardDescription className="text-slate-400">ACTION_REQUIRED y REVIEW no se mezclan. Las correcciones se agregan al historial sin mutar el hallazgo original.</CardDescription></CardHeader><CardContent className="space-y-3">{evidence.risks?.map((risk) => <div key={risk.riskId} className="rounded-xl border border-white/10 p-4"><div className="flex justify-between gap-2"><p className="font-semibold">{risk.title}</p><Badge variant="outline">{risk.classification}{risk.classification === 'ACTION_REQUIRED' ? ` · ${risk.priority}` : ''}</Badge></div><p className="mt-2 text-sm text-slate-400">{risk.description}</p><p className="mt-2 text-sm text-cyan-300">{risk.recommendedAction}</p>{risk.missingEvidence.length > 0 && <p className="mt-2 text-xs text-amber-300">Falta: {risk.missingEvidence.join(' · ')}</p>}<div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => void decideRisk(risk.riskId, 'ACKNOWLEDGE')}>Reconocer</Button><Button size="sm" variant="outline" onClick={() => void decideRisk(risk.riskId, 'COMMENT')}>Agregar corrección</Button><Button size="sm" variant="outline" onClick={() => void decideRisk(risk.riskId, 'POSTPONE')}>Posponer</Button><Button size="sm" variant="outline" className="border-orange-500/30 text-orange-300" onClick={() => void decideRisk(risk.riskId, 'MARK_INCORRECT')}>Marcar incorrecto</Button></div></div>)}</CardContent></Card>
    <Card className="border-white/10 bg-slate-950/80 text-slate-100"><CardHeader><CardTitle>Cobertura</CardTitle></CardHeader><CardContent className="grid gap-4 md:grid-cols-2"><div><p className="text-emerald-300">Observadas</p>{evidence.metadata?.coverage?.observed.map((item) => <p key={item} className="text-sm text-slate-400">✓ {item}</p>)}</div><div><p className="text-amber-300">UNOBSERVED</p>{evidence.metadata?.coverage?.unobserved.map((item) => <p key={item} className="text-sm text-slate-400">— {item}</p>)}</div></CardContent></Card>
    <Card className="border-white/10 bg-slate-950/80 text-slate-100"><CardHeader><CardTitle>Eventos append-only</CardTitle></CardHeader><CardContent className="flex flex-wrap gap-2">{companyCase.events.map((event) => <Badge key={event.id} variant="outline">#{event.sequence} {event.eventType}</Badge>)}</CardContent></Card>
  </div>;
}

export function CompanyOsDashboard() {
  const [agentId, setAgentId] = useState<'general-manager-ai-v3' | 'systems-manager-ai-v1'>('systems-manager-ai-v1');
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [reports, setReports] = useState<CaseSummary[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [objective, setObjective] = useState('');
  const [relatedRequestId, setRelatedRequestId] = useState('');
  const [context, setContext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selected = cases.find((entry) => entry.requestId === selectedId) ?? cases[0];
  const activeCount = cases.filter((entry) => activeStatuses.has(entry.status)).length;

  const refresh = useCallback(async () => {
    const response = await fetch(agentId === 'general-manager-ai-v3' ? '/api/company-os/v3/cases?limit=100' : `/api/company-os/v3/cases?limit=50&agentId=${agentId}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('No se pudo leer el inbox');
    const payload = await response.json();
    const received = (payload.cases ?? []) as CaseSummary[];
    setCases(received.filter((entry) => entry.agentId === agentId));
    setReports(agentId === 'general-manager-ai-v3' ? received.filter((entry) => entry.agentId === 'systems-manager-ai-v1') : []);
  }, [agentId]);

  useEffect(() => { void refresh().catch((caught) => setError(caught.message)); }, [refresh]);
  useEffect(() => {
    if (!activeCount) return;
    const timer = setInterval(() => void refresh().catch(() => undefined), 5000);
    return () => clearInterval(timer);
  }, [activeCount, refresh]);

  const totals = useMemo(() => cases.reduce((acc, companyCase) => {
    for (const usage of companyCase.usage) {
      acc.tokens += usage.totalTokens; acc.cost += Number(usage.estimatedCostUsd);
    }
    return acc;
  }, { tokens: 0, cost: 0 }), [cases]);

  async function createCase() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/company-os/v3/cases', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ objective, relatedRequestId: relatedRequestId || undefined, agentId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'No se pudo crear el caso');
      setObjective(''); setRelatedRequestId(''); setSelectedId(payload.requestId); await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Error inesperado'); }
    finally { setBusy(false); }
  }

  async function appendContext() {
    if (!selected || !context.trim()) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/company-os/v3/cases/${selected.requestId}/messages`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: context }),
      });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error);
      setContext(''); await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Error inesperado'); }
    finally { setBusy(false); }
  }

  async function cancelCase() {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/company-os/v3/cases/${selected.requestId}/cancel`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'Cancelado desde Company OS' }),
      });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error); await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Error inesperado'); }
    finally { setBusy(false); }
  }

  async function decideMission(missionId: string, decision: 'APPROVE' | 'REJECT' | 'REQUEST_REVIEW' | 'BLOCK' | 'EDIT' | 'POSTPONE' | 'MARK_INCORRECT', extra: Record<string, unknown> = {}) {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/company-os/v3/missions', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: selected.requestId, missionId, decision, idempotencyKey: crypto.randomUUID(), ...extra }),
      });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error); await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Error inesperado'); }
    finally { setBusy(false); }
  }

  async function captureMissionDecision(mission: CaseSummary['missions'][number], decision: 'EDIT'|'POSTPONE'|'MARK_INCORRECT') {
    if (decision === 'EDIT') {
      const title = window.prompt('Título corregido', mission.title)?.trim();
      if (!title) return;
      const expectedOutput = window.prompt('Entregable corregido', mission.expectedOutput)?.trim();
      if (!expectedOutput) return;
      await decideMission(mission.id, decision, { revision: { title, expectedOutput, rationale: mission.rationale } });
      return;
    }
    if (decision === 'POSTPONE') {
      const deferUntil = window.prompt('Fecha ISO para revisar nuevamente (ej. 2026-08-20T14:00:00-04:00)')?.trim();
      if (!deferUntil) return;
      await decideMission(mission.id, decision, { deferUntil });
      return;
    }
    const reason = window.prompt('Indique qué información es incorrecta')?.trim();
    if (reason) await decideMission(mission.id, decision, { reason });
  }

  async function decideRisk(riskId: string, decision: 'ACKNOWLEDGE'|'POSTPONE'|'MARK_INCORRECT'|'COMMENT') {
    if (!selected) return;
    const reason = window.prompt(decision === 'MARK_INCORRECT' ? 'Indique por qué el riesgo es incorrecto' : 'Motivo o comentario auditable')?.trim();
    if (!reason) return;
    const deferUntil = decision === 'POSTPONE' ? window.prompt('Fecha ISO para revisar nuevamente (ej. 2026-08-20T14:00:00-04:00)')?.trim() : undefined;
    if (decision === 'POSTPONE' && !deferUntil) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/company-os/v3/risks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: selected.requestId, riskId, decision, reason, deferUntil, idempotencyKey: crypto.randomUUID() }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error); await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Error inesperado'); }
    finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen bg-[#07090f] p-4 text-slate-100 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="rounded-3xl border border-cyan-500/20 bg-gradient-to-br from-slate-950 via-indigo-950/50 to-slate-950 p-6 shadow-2xl">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div><Badge className="mb-3 border-emerald-500/30 bg-emerald-500/10 text-emerald-300">{agentId} · ADVISORY ONLY</Badge><h1 className="flex items-center gap-3 text-3xl font-black"><BrainCircuit className="text-cyan-300" /> Company OS</h1><p className="mt-3 max-w-3xl text-sm text-slate-300">{agentId === 'systems-manager-ai-v1' ? 'Gerente de Sistemas AI · reporta a general-manager-ai-v3 · sin cambios autónomos de infraestructura.' : 'Gerente General AI · análisis empresarial sólo lectura.'}</p></div>
            <div className="grid gap-2 text-xs sm:grid-cols-3">
              <Badge variant="outline" className="p-3"><Activity className="mr-2 h-4 w-4" /> {activeCount} activos</Badge>
              <Badge variant="outline" className="p-3"><ShieldCheck className="mr-2 h-4 w-4 text-emerald-300" /> Contrato: 0 escrituras empresariales</Badge>
              <Badge variant="outline" className="p-3">{totals.tokens.toLocaleString()} tokens · ${totals.cost.toFixed(4)}</Badge>
            </div>
          </div>
        </section>

        {error && <p className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}

        <div className="flex flex-wrap gap-2"><Button variant={agentId === 'systems-manager-ai-v1' ? 'default' : 'outline'} onClick={() => { setAgentId('systems-manager-ai-v1'); setSelectedId(''); }}><ServerCog className="mr-2 h-4 w-4" />Gerente de Sistemas</Button><Button variant={agentId === 'general-manager-ai-v3' ? 'default' : 'outline'} onClick={() => { setAgentId('general-manager-ai-v3'); setSelectedId(''); }}><BrainCircuit className="mr-2 h-4 w-4" />Gerente General</Button></div>

        {agentId === 'general-manager-ai-v3' && <Card className="border-violet-500/20 bg-slate-950/80 text-slate-100"><CardHeader><CardTitle>Handoff del Gerente de Sistemas</CardTitle><CardDescription className="text-slate-400">Resultados y misiones técnicas reportados a general-manager-ai-v3.</CardDescription></CardHeader><CardContent className="space-y-2">{reports.length === 0 ? <p className="text-sm text-slate-500">Sin reportes técnicos.</p> : reports.slice(0, 20).map((report) => { const result = report.messages.find((message) => message.kind === 'RESULT'); return <div key={report.requestId} className="rounded-xl border border-white/10 p-3"><div className="flex flex-wrap justify-between gap-2"><Badge variant="outline" className={statusColor[report.status]}>{report.status}</Badge><span className="font-mono text-[10px] text-slate-500">{report.requestId}</span></div><p className="mt-2 text-sm">{result ? resultContent(result.content).summary : report.objective}</p><p className="mt-2 text-xs text-violet-300">{report.missions.length} misiones creadas por systems-manager-ai-v1 · reporta a general-manager-ai-v3</p></div>; })}</CardContent></Card>}

        <Card className="border-white/10 bg-slate-950/80 text-slate-100"><CardHeader><CardTitle>Nueva orden · {agentId === 'systems-manager-ai-v1' ? 'Gerente de Sistemas' : 'Gerente General'}</CardTitle><CardDescription className="text-slate-400">El caso se persiste antes del webhook y queda recuperable si la entrega inmediata falla.</CardDescription></CardHeader><CardContent className="space-y-3"><Textarea value={objective} onChange={(event) => setObjective(event.target.value)} maxLength={600} className="min-h-24 border-white/10 bg-black/30" placeholder={agentId === 'systems-manager-ai-v1' ? '¿Qué debe analizar el Gerente de Sistemas?' : '¿Qué debe analizar el Gerente General?'} /><Input value={relatedRequestId} onChange={(event) => setRelatedRequestId(event.target.value)} className="border-white/10 bg-black/30" placeholder="Request ID relacionado (opcional)" /><Button onClick={createCase} disabled={busy || !objective.trim()} className="bg-cyan-400 font-bold text-slate-950 hover:bg-cyan-300">{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Encolar análisis</Button></CardContent></Card>

        <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
          <Card className="border-white/10 bg-slate-950/80 text-slate-100"><CardHeader><div className="flex items-center justify-between"><CardTitle>Inbox</CardTitle><Button size="sm" variant="outline" onClick={() => void refresh()}><RefreshCw className="h-4 w-4" /></Button></div></CardHeader><CardContent className="max-h-[760px] space-y-2 overflow-auto">{cases.map((companyCase) => <button key={companyCase.requestId} onClick={() => setSelectedId(companyCase.requestId)} className={`w-full rounded-xl border p-3 text-left ${selected?.requestId === companyCase.requestId ? 'border-cyan-400/50 bg-cyan-500/10' : 'border-white/10 bg-white/5'}`}><div className="flex items-center justify-between gap-2"><Badge variant="outline" className={statusColor[companyCase.status]}>{companyCase.status}</Badge><span className="text-[10px] text-slate-500">{new Date(companyCase.createdAt).toLocaleString('es-AR')}</span></div><p className="mt-2 line-clamp-2 text-sm">{companyCase.objective}</p><p className="mt-2 font-mono text-[10px] text-slate-600">{companyCase.requestId}</p></button>)}</CardContent></Card>

          <div className="space-y-5">{selected ? <>
            <Card className="border-white/10 bg-slate-950/80 text-slate-100"><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle>Hilo del caso</CardTitle><Badge variant="outline" className={statusColor[selected.status]}>{selected.status}</Badge></div><CardDescription className="text-slate-500">{selected.agentId} · {selected.requestId} · webhook {selected.webhookDeliveryStatus}{selected.heartbeats[0] ? ` · heartbeat ${new Date(selected.heartbeats[0].createdAt).toLocaleTimeString('es-AR')}` : ''}</CardDescription></CardHeader><CardContent className="space-y-3">{selected.messages.map((message) => { const parsed = message.kind === 'RESULT' ? resultContent(message.content) : null; return <div key={message.id} className="rounded-xl border border-white/10 bg-white/5 p-4"><div className="mb-2 flex justify-between text-[10px] uppercase text-slate-500"><span>{message.role} · {message.kind}</span><span>{new Date(message.createdAt).toLocaleString('es-AR')}</span></div>{parsed ? <div className="space-y-2 text-sm"><p>{parsed.summary}</p>{parsed.primaryConfirmedRisk ? <><p><b className="text-red-300">Riesgo confirmado:</b> {parsed.primaryConfirmedRisk}</p><p><b className="text-amber-300">Gap de cobertura:</b> {parsed.primaryCoverageGap}</p><p><b className="text-cyan-300">Próximos pasos:</b> {parsed.confirmedRiskNextStep} · {parsed.coverageGapNextStep}</p></> : <><p><b className="text-amber-300">Problema principal:</b> {parsed.primaryDataQualityProblem}</p><p><b className="text-cyan-300">Próximo paso:</b> {parsed.recommendedNextStep}</p></>}<p className="text-xs text-slate-500">Evidencia: {parsed.evidenceRefs?.join(', ')}</p></div> : <p className="whitespace-pre-wrap text-sm">{message.content}</p>}</div>; })}<div className="flex gap-2"><Textarea value={context} onChange={(event) => setContext(event.target.value)} maxLength={4000} className="border-white/10 bg-black/30" placeholder="Respuesta o contexto adicional append-only" /><Button onClick={appendContext} disabled={busy || !context.trim()}><MessageSquarePlus className="h-4 w-4" /></Button></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => { setRelatedRequestId(selected.requestId); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><GitBranch className="mr-2 h-4 w-4" />Crear caso relacionado</Button>{!['FAILED','CANCELLED','COMPLETED'].includes(selected.status) && <Button variant="outline" onClick={cancelCase} disabled={busy} className="border-red-500/30 text-red-300"><Ban className="mr-2 h-4 w-4" />Cancelar caso</Button>}</div></CardContent></Card>

            {selected.agentId === 'systems-manager-ai-v1' && <SystemsEvidence companyCase={selected} decideRisk={decideRisk} />}

            {selected.missions.length > 0 && <Card className="border-white/10 bg-slate-950/80 text-slate-100"><CardHeader><CardTitle>Misiones · ciclo independiente</CardTitle><CardDescription className="text-amber-300">Aprobar valida el análisis; RUNNING y DONE son inalcanzables y nunca ejecutan acciones.</CardDescription></CardHeader><CardContent className="space-y-3">{selected.missions.map((mission) => { const terminal = ['APPROVED','REJECTED','BLOCKED'].includes(mission.status); return <div key={mission.id} className="rounded-xl border border-white/10 p-4"><div className="flex justify-between gap-3"><p className="font-bold">{mission.title}</p><Badge variant="outline">{mission.status}</Badge></div><p className="mt-2 text-sm text-slate-400">{mission.expectedOutput}</p><p className="mt-1 text-xs text-slate-600">{mission.rationale}</p><p className="mt-2 text-xs text-violet-300">Creada por {selected.agentId} · reporta a {selected.agentId === 'systems-manager-ai-v1' ? 'general-manager-ai-v3' : 'Diego'}</p><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" disabled={terminal} onClick={() => decideMission(mission.id, 'APPROVE')}>Aprobar análisis</Button><Button size="sm" variant="outline" disabled={terminal} onClick={() => decideMission(mission.id, 'REQUEST_REVIEW')}>Revisar</Button><Button size="sm" variant="outline" disabled={terminal} onClick={() => decideMission(mission.id, 'REJECT')}>Rechazar</Button><Button size="sm" variant="outline" disabled={terminal} onClick={() => void captureMissionDecision(mission, 'EDIT')}>Editar</Button><Button size="sm" variant="outline" disabled={terminal} onClick={() => void captureMissionDecision(mission, 'POSTPONE')}>Posponer</Button><Button size="sm" variant="outline" disabled={terminal} onClick={() => void captureMissionDecision(mission, 'MARK_INCORRECT')}>Información incorrecta</Button><Button size="sm" variant="outline" disabled={terminal} onClick={() => decideMission(mission.id, 'BLOCK')}>Bloquear</Button></div></div>; })}</CardContent></Card>}

            {selected.usage.map((usage, index) => <Card key={index} className="border-white/10 bg-slate-950/80 text-slate-100"><CardHeader><CardTitle className="flex items-center gap-2"><Clock3 className="h-5 w-5 text-violet-300" /> Consumo verificado</CardTitle></CardHeader><CardContent className="grid gap-2 text-sm sm:grid-cols-3"><span>Entrada: {usage.inputTokens}</span><span>Cacheados: {usage.cachedTokens}</span><span>Cache write: {usage.cacheWriteTokens}</span><span>Salida: {usage.outputTokens}</span><span>Razonamiento: {usage.reasoningTokens}</span><span>Total: {usage.totalTokens}</span><span>Costo: ${Number(usage.estimatedCostUsd).toFixed(6)}</span><span>Acumulado diario: {usage.dailyTotalTokens}</span><span>Costo diario: ${Number(usage.dailyCostUsd).toFixed(6)}</span><span>Duración: {usage.durationMs ?? 0} ms</span><span>Reintentos: {usage.retries ?? 0}</span><span>Snapshot: {usage.snapshotBytes ?? 0} bytes</span>{usage.responseId && <span className="truncate font-mono text-xs">Response: {usage.responseId}</span>}{usage.rulesApplied && <span className="sm:col-span-2">Reglas: {usage.rulesApplied.join(' · ')}</span>}{usage.alertLevel && <Badge variant="outline" className="border-amber-500/30 text-amber-300">Alerta diaria {usage.alertLevel}%</Badge>}</CardContent></Card>)}
          </> : <Card className="border-white/10 bg-slate-950/80 text-slate-100"><CardContent className="flex min-h-64 items-center justify-center text-slate-500"><CheckCircle2 className="mr-2 h-5 w-5" /> No hay casos todavía</CardContent></Card>}</div>
        </div>
      </div>
    </div>
  );
}
