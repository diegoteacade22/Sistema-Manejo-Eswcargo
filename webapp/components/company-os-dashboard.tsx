'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Ban, BrainCircuit, CheckCircle2, Clock3, Loader2, MessageSquarePlus, RefreshCw, Send, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';

type RequestStatus = 'QUEUED' | 'ANALYZING' | 'AWAITING_REVIEW' | 'BLOCKED' | 'FAILED' | 'CANCELLED' | 'COMPLETED';
type MissionStatus = 'PLANNED' | 'APPROVED' | 'REJECTED' | 'REVIEW' | 'BLOCKED' | 'RUNNING' | 'DONE';
type CaseSummary = {
  id: string; requestId: string; objective: string; status: RequestStatus; relatedCaseId?: string | null;
  webhookDeliveryStatus: string; createdAt: string; updatedAt: string;
  messages: Array<{ id: string; role: string; kind: string; content: string; createdAt: string }>;
  missions: Array<{ id: string; title: string; rationale: string; expectedOutput: string; status: MissionStatus }>;
  usage: Array<{ inputTokens: number; cachedTokens: number; cacheWriteTokens: number; outputTokens: number; reasoningTokens: number; totalTokens: number; estimatedCostUsd: string; dailyTotalTokens: number; dailyCostUsd: string; alertLevel?: number | null }>;
  heartbeats: Array<{ createdAt: string; phase: string }>;
};

const activeStatuses = new Set<RequestStatus>(['QUEUED', 'ANALYZING']);
const statusColor: Record<RequestStatus, string> = {
  QUEUED: 'border-sky-500/40 text-sky-300', ANALYZING: 'border-violet-500/40 text-violet-300',
  AWAITING_REVIEW: 'border-amber-500/40 text-amber-300', BLOCKED: 'border-orange-500/40 text-orange-300',
  FAILED: 'border-red-500/40 text-red-300', CANCELLED: 'border-slate-500/40 text-slate-400', COMPLETED: 'border-emerald-500/40 text-emerald-300',
};

function resultContent(content: string) {
  try { return JSON.parse(content) as { summary?: string; primaryDataQualityProblem?: string; recommendedNextStep?: string; evidenceRefs?: string[] }; }
  catch { return { summary: content }; }
}

export function CompanyOsDashboard() {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [objective, setObjective] = useState('');
  const [relatedRequestId, setRelatedRequestId] = useState('');
  const [context, setContext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selected = cases.find((entry) => entry.requestId === selectedId) ?? cases[0];
  const activeCount = cases.filter((entry) => activeStatuses.has(entry.status)).length;

  const refresh = useCallback(async () => {
    const response = await fetch('/api/company-os/v3/cases?limit=50', { cache: 'no-store' });
    if (!response.ok) throw new Error('No se pudo leer el inbox');
    const payload = await response.json();
    setCases(payload.cases ?? []);
  }, []);

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
        body: JSON.stringify({ objective, relatedRequestId: relatedRequestId || undefined }),
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

  async function decideMission(missionId: string, decision: 'APPROVE' | 'REJECT' | 'REQUEST_REVIEW' | 'BLOCK') {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/company-os/v3/missions', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: selected.requestId, missionId, decision, idempotencyKey: crypto.randomUUID() }),
      });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error); await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Error inesperado'); }
    finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen bg-[#07090f] p-4 text-slate-100 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="rounded-3xl border border-cyan-500/20 bg-gradient-to-br from-slate-950 via-indigo-950/50 to-slate-950 p-6 shadow-2xl">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div><Badge className="mb-3 border-emerald-500/30 bg-emerald-500/10 text-emerald-300">general-manager-ai-v3 · ADVISORY ONLY</Badge><h1 className="flex items-center gap-3 text-3xl font-black"><BrainCircuit className="text-cyan-300" /> Company OS</h1><p className="mt-3 max-w-3xl text-sm text-slate-300">Casos persistentes, análisis empresarial sólo lectura y aprobación humana. Aprobar una misión no autoriza su ejecución.</p></div>
            <div className="grid gap-2 text-xs sm:grid-cols-3">
              <Badge variant="outline" className="p-3"><Activity className="mr-2 h-4 w-4" /> {activeCount} activos</Badge>
              <Badge variant="outline" className="p-3"><ShieldCheck className="mr-2 h-4 w-4 text-emerald-300" /> Contrato: 0 escrituras empresariales</Badge>
              <Badge variant="outline" className="p-3">{totals.tokens.toLocaleString()} tokens · ${totals.cost.toFixed(4)}</Badge>
            </div>
          </div>
        </section>

        {error && <p className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}

        <Card className="border-white/10 bg-slate-950/80 text-slate-100"><CardHeader><CardTitle>Nueva orden</CardTitle><CardDescription className="text-slate-400">El caso se persiste antes del webhook y queda recuperable si la entrega inmediata falla.</CardDescription></CardHeader><CardContent className="space-y-3"><Textarea value={objective} onChange={(event) => setObjective(event.target.value)} maxLength={600} className="min-h-24 border-white/10 bg-black/30" placeholder="¿Qué debe analizar el Gerente General?" /><Input value={relatedRequestId} onChange={(event) => setRelatedRequestId(event.target.value)} className="border-white/10 bg-black/30" placeholder="Request ID relacionado (opcional)" /><Button onClick={createCase} disabled={busy || !objective.trim()} className="bg-cyan-400 font-bold text-slate-950 hover:bg-cyan-300">{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Encolar análisis</Button></CardContent></Card>

        <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
          <Card className="border-white/10 bg-slate-950/80 text-slate-100"><CardHeader><div className="flex items-center justify-between"><CardTitle>Inbox</CardTitle><Button size="sm" variant="outline" onClick={() => void refresh()}><RefreshCw className="h-4 w-4" /></Button></div></CardHeader><CardContent className="max-h-[760px] space-y-2 overflow-auto">{cases.map((companyCase) => <button key={companyCase.requestId} onClick={() => setSelectedId(companyCase.requestId)} className={`w-full rounded-xl border p-3 text-left ${selected?.requestId === companyCase.requestId ? 'border-cyan-400/50 bg-cyan-500/10' : 'border-white/10 bg-white/5'}`}><div className="flex items-center justify-between gap-2"><Badge variant="outline" className={statusColor[companyCase.status]}>{companyCase.status}</Badge><span className="text-[10px] text-slate-500">{new Date(companyCase.createdAt).toLocaleString('es-AR')}</span></div><p className="mt-2 line-clamp-2 text-sm">{companyCase.objective}</p><p className="mt-2 font-mono text-[10px] text-slate-600">{companyCase.requestId}</p></button>)}</CardContent></Card>

          <div className="space-y-5">{selected ? <>
            <Card className="border-white/10 bg-slate-950/80 text-slate-100"><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle>Hilo del caso</CardTitle><Badge variant="outline" className={statusColor[selected.status]}>{selected.status}</Badge></div><CardDescription className="text-slate-500">{selected.requestId} · webhook {selected.webhookDeliveryStatus}{selected.heartbeats[0] ? ` · heartbeat ${new Date(selected.heartbeats[0].createdAt).toLocaleTimeString('es-AR')}` : ''}</CardDescription></CardHeader><CardContent className="space-y-3">{selected.messages.map((message) => { const parsed = message.kind === 'RESULT' ? resultContent(message.content) : null; return <div key={message.id} className="rounded-xl border border-white/10 bg-white/5 p-4"><div className="mb-2 flex justify-between text-[10px] uppercase text-slate-500"><span>{message.role} · {message.kind}</span><span>{new Date(message.createdAt).toLocaleString('es-AR')}</span></div>{parsed ? <div className="space-y-2 text-sm"><p>{parsed.summary}</p><p><b className="text-amber-300">Problema principal:</b> {parsed.primaryDataQualityProblem}</p><p><b className="text-cyan-300">Próximo paso:</b> {parsed.recommendedNextStep}</p><p className="text-xs text-slate-500">Evidencia: {parsed.evidenceRefs?.join(', ')}</p></div> : <p className="whitespace-pre-wrap text-sm">{message.content}</p>}</div>; })}<div className="flex gap-2"><Textarea value={context} onChange={(event) => setContext(event.target.value)} maxLength={4000} className="border-white/10 bg-black/30" placeholder="Respuesta o contexto adicional append-only" /><Button onClick={appendContext} disabled={busy || !context.trim()}><MessageSquarePlus className="h-4 w-4" /></Button></div>{!['FAILED','CANCELLED','COMPLETED'].includes(selected.status) && <Button variant="outline" onClick={cancelCase} disabled={busy} className="border-red-500/30 text-red-300"><Ban className="mr-2 h-4 w-4" />Cancelar caso</Button>}</CardContent></Card>

            {selected.missions.length > 0 && <Card className="border-white/10 bg-slate-950/80 text-slate-100"><CardHeader><CardTitle>Misiones · ciclo independiente</CardTitle><CardDescription className="text-amber-300">V3 nunca cambia una misión a RUNNING o DONE.</CardDescription></CardHeader><CardContent className="space-y-3">{selected.missions.map((mission) => <div key={mission.id} className="rounded-xl border border-white/10 p-4"><div className="flex justify-between gap-3"><p className="font-bold">{mission.title}</p><Badge variant="outline">{mission.status}</Badge></div><p className="mt-2 text-sm text-slate-400">{mission.expectedOutput}</p><p className="mt-1 text-xs text-slate-600">{mission.rationale}</p><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" onClick={() => decideMission(mission.id, 'APPROVE')}>Aprobar plan</Button><Button size="sm" variant="outline" onClick={() => decideMission(mission.id, 'REQUEST_REVIEW')}>Revisar</Button><Button size="sm" variant="outline" onClick={() => decideMission(mission.id, 'REJECT')}>Rechazar</Button><Button size="sm" variant="outline" onClick={() => decideMission(mission.id, 'BLOCK')}>Bloquear</Button></div></div>)}</CardContent></Card>}

            {selected.usage.map((usage, index) => <Card key={index} className="border-white/10 bg-slate-950/80 text-slate-100"><CardHeader><CardTitle className="flex items-center gap-2"><Clock3 className="h-5 w-5 text-violet-300" /> Consumo verificado</CardTitle></CardHeader><CardContent className="grid gap-2 text-sm sm:grid-cols-3"><span>Entrada: {usage.inputTokens}</span><span>Cacheados: {usage.cachedTokens}</span><span>Cache write: {usage.cacheWriteTokens}</span><span>Salida: {usage.outputTokens}</span><span>Razonamiento: {usage.reasoningTokens}</span><span>Total: {usage.totalTokens}</span><span>Costo: ${Number(usage.estimatedCostUsd).toFixed(6)}</span><span>Acumulado diario: {usage.dailyTotalTokens}</span><span>Costo diario: ${Number(usage.dailyCostUsd).toFixed(6)}</span>{usage.alertLevel && <Badge variant="outline" className="border-amber-500/30 text-amber-300">Alerta {usage.alertLevel}%</Badge>}</CardContent></Card>)}
          </> : <Card className="border-white/10 bg-slate-950/80 text-slate-100"><CardContent className="flex min-h-64 items-center justify-center text-slate-500"><CheckCircle2 className="mr-2 h-5 w-5" /> No hay casos todavía</CardContent></Card>}</div>
        </div>
      </div>
    </div>
  );
}
