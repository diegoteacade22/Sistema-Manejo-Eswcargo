'use client';

import { useState } from 'react';
import { BrainCircuit, CheckCircle2, Database, Loader2, ShieldCheck, Sparkles, UsersRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import type { CompanyBrief } from '@/lib/company-os/types';

const urgencyStyle = {
  P0: 'border-red-500/40 bg-red-500/10 text-red-300',
  P1: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  P2: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300',
};

export function CompanyOsDashboard() {
  const runtimeLabel = process.env.NEXT_PUBLIC_VERCEL_ENV === 'production' ? 'PRODUCCIÓN' : 'ENTORNO DE PRUEBA';
  const [objective, setObjective] = useState('');
  const [brief, setBrief] = useState<CompanyBrief | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function generateBrief() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/company-os/brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objective }),
      });
      const payload = await response.json();
      if (!response.ok && response.status !== 207) throw new Error(payload.error || 'No se pudo generar el brief');
      const snapshotHeader = response.headers.get('X-Company-OS-Snapshot');
      const runHeader = response.headers.get('X-Company-OS-Run');
      if (!snapshotHeader || snapshotHeader !== payload.execution?.snapshotId) throw new Error('Readback de snapshot inconsistente');
      if (!runHeader || runHeader !== payload.execution?.auditRunId) throw new Error('Readback de auditoría inconsistente');
      setBrief(payload);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#07090f] p-4 text-slate-100 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="overflow-hidden rounded-3xl border border-cyan-500/20 bg-gradient-to-br from-slate-950 via-indigo-950/50 to-slate-950 p-6 shadow-2xl md:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-3xl">
              <Badge className="mb-4 border-emerald-500/30 bg-emerald-500/10 text-emerald-300">{runtimeLabel} · DATOS DE NEGOCIO SOLO LECTURA</Badge>
              <h1 className="flex items-center gap-3 text-3xl font-black tracking-tight md:text-5xl">
                <BrainCircuit className="h-10 w-10 text-cyan-300" /> Gerente General AI
              </h1>
              <p className="mt-4 text-sm leading-relaxed text-slate-300 md:text-base">
                Primer agente empresarial de ESWTECH/ESWCARGO. Lee el estado operativo vigente, concentra un máximo de cinco prioridades y organiza misiones para cada área sin ejecutar pagos, compras, mensajes ni cambios de datos.
              </p>
            </div>
            <div className="grid min-w-[280px] grid-cols-1 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-1">
              <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3"><Database className="h-5 w-5 text-cyan-300" /> Datos live</div>
              <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3"><ShieldCheck className="h-5 w-5 text-emerald-300" /> 0 cambios de negocio</div>
              <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3"><UsersRound className="h-5 w-5 text-violet-300" /> 6 áreas delegables</div>
            </div>
          </div>
        </section>

        <Card className="border-white/10 bg-slate-950/80 text-slate-100">
          <CardHeader>
            <CardTitle>Objetivo de este ciclo</CardTitle>
            <CardDescription className="text-slate-400">Opcional. Si queda vacío, el agente genera el brief operativo actual.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
              maxLength={1200}
              placeholder="Ejemplo: organizar los frentes críticos de esta semana y reducir mis intervenciones manuales."
              className="min-h-28 border-white/10 bg-black/30"
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={generateBrief} disabled={loading} className="bg-cyan-500 font-bold text-slate-950 hover:bg-cyan-300">
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                {loading ? 'Analizando operación…' : 'Generar brief ejecutivo'}
              </Button>
              <span className="text-xs text-slate-500">El ciclo persiste su bitácora; no modifica datos empresariales.</span>
              <span className="text-xs text-amber-300">No ingreses nombres de clientes, emails, teléfonos, contraseñas ni claves.</span>
            </div>
            {error && <p className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
          </CardContent>
        </Card>

        {brief && (
          <div className="space-y-6" data-testid="company-os-brief">
            <Card className="border-indigo-500/20 bg-gradient-to-br from-indigo-950/70 to-slate-950 text-slate-100">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <CardTitle>Brief ejecutivo · {brief.businessDate}</CardTitle>
                  <div className="flex gap-2">
                    <Badge variant="outline" className="border-cyan-500/30 text-cyan-300">{brief.status}</Badge>
                    <Badge variant="outline" className={brief.execution.provider === 'openai' ? 'border-emerald-500/30 text-emerald-300' : 'border-amber-500/30 text-amber-300'}>
                      {brief.execution.provider === 'openai' ? `OpenAI · ${brief.execution.model}` : 'Fallback seguro'}
                    </Badge>
                  </div>
                </div>
                <CardDescription className="pt-2 text-base leading-relaxed text-slate-300">{brief.executiveSummary}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 text-xs text-slate-400 sm:grid-cols-3">
                <span>Snapshot: {brief.execution.snapshotId}</span>
                <span>Corte: {new Date(brief.dataQuality.cutoff).toLocaleString('es-AR', { timeZone: 'America/New_York' })}</span>
                <span className="flex items-center gap-1 text-emerald-300"><CheckCircle2 className="h-3 w-3" /> 0 cambios de negocio · bitácora append-only</span>
                <span>Response: {brief.execution.responseId || 'fallback'}</span>
                <span>Run: {brief.execution.auditRunId}</span>
              </CardContent>
            </Card>

            <section>
              <h2 className="mb-3 text-xl font-black">Prioridades</h2>
              <div className="grid gap-4 lg:grid-cols-2">
                {brief.priorities.map((priority) => (
                  <Card key={priority.id} className="border-white/10 bg-slate-950/80 text-slate-100">
                    <CardHeader>
                      <div className="flex items-start justify-between gap-3">
                        <CardTitle className="text-base">{priority.title}</CardTitle>
                        <Badge variant="outline" className={urgencyStyle[priority.urgency]}>{priority.urgency}</Badge>
                      </div>
                      <CardDescription className="text-slate-400">{priority.area} · {priority.owner} · {priority.dueWindow}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <ul className="list-disc space-y-1 pl-5 text-slate-400">
                        {priority.evidence.map((item) => <li key={item}>{item}</li>)}
                      </ul>
                      <p className="rounded-xl border border-white/10 bg-white/5 p-3 text-slate-200">{priority.recommendedAction}</p>
                      {priority.requiresHumanApproval && <Badge variant="outline" className="border-amber-500/30 text-amber-300">Requiere aprobación humana</Badge>}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>

            <section>
              <h2 className="mb-1 text-xl font-black">Planes de misión</h2>
              <p className="mb-3 text-sm text-slate-400">Planificados para coordinación; todavía no ejecutados.</p>
              <div className="space-y-3">
                {brief.delegations.map((delegation, index) => (
                  <div key={`${delegation.agent}-${index}`} className="grid gap-2 rounded-2xl border border-white/10 bg-slate-950/80 p-4 md:grid-cols-[180px_1fr]">
                    <div>
                      <div className="font-bold text-violet-300">{delegation.agent}</div>
                      <Badge variant="outline" className="mt-2 border-amber-500/30 text-amber-300">{delegation.status}</Badge>
                    </div>
                    <div>
                      <p className="font-semibold text-slate-100">{delegation.mission}</p>
                      <p className="mt-1 text-sm text-slate-400">{delegation.why}</p>
                      <p className="mt-2 text-xs text-cyan-300">Entregable: {delegation.expectedOutput}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <Card className="border-white/10 bg-slate-950/80 text-slate-100">
              <CardHeader><CardTitle>Calidad y límites</CardTitle></CardHeader>
              <CardContent className="grid gap-6 md:grid-cols-3">
                <div><p className="mb-2 font-bold text-emerald-300">Cobertura</p><ul className="space-y-1 text-sm text-slate-400">{brief.dataQuality.coverage.map((item) => <li key={item}>• {item}</li>)}</ul></div>
                <div><p className="mb-2 font-bold text-amber-300">Brechas</p><ul className="space-y-1 text-sm text-slate-400">{brief.dataQuality.gaps.map((item) => <li key={item}>• {item}</li>)}</ul></div>
                <div><p className="mb-2 font-bold text-cyan-300">Guardrails</p><ul className="space-y-1 text-sm text-slate-400">{brief.guardrails.map((item) => <li key={item}>• {item}</li>)}</ul></div>
              </CardContent>
            </Card>

            {brief.warnings.length > 0 && (
              <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">{brief.warnings.join(' · ')}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
