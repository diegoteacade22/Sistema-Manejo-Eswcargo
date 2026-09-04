"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { CalendarClock, CheckCircle2, Loader2, Pause, Play, RefreshCw, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { formatCompanyOsTimestamp } from '@/lib/company-os/runtime-display';
import { CONTINUOUS_OBJECTIVE_EXTERNAL_SOURCES, type ContinuousObjectiveExternalSourceId, type ContinuousObjectiveView } from '@/lib/company-os/continuous-objective-types';

export type ContinuousObjectiveDisplay = ContinuousObjectiveView;
type ExternalSourceDisplay = Omit<typeof CONTINUOUS_OBJECTIVE_EXTERNAL_SOURCES[number], 'status' | 'note'> & { status: string; note: string };
type Snapshot = { objectives: ContinuousObjectiveDisplay[]; allowedProjects: string[]; externalSources: ExternalSourceDisplay[] };
const ENDPOINT = '/api/company-os/objectives';
const COUNT_KEYS = ['planned', 'queued', 'analyzed', 'verified', 'needsReview', 'blocked', 'skipped'] as const;
const managerNames: Record<string, string> = {
  'general-manager-ai-v3': 'Gerente General',
  'systems-manager-ai-v1': 'Gerente de Sistemas',
  'data-manager-ai-v1': 'Gerente de Datos',
};
const stateNames: Record<string, string> = {
  ACTIVE: 'Activo', PAUSED: 'Pausado', EXPIRED: 'Plazo terminado',
  PLANNED: 'Planificada', QUEUED: 'En cola', ANALYZED: 'Análisis de metadatos', VERIFIED: 'Análisis verificado',
  NEEDS_REVIEW: 'Revisión pendiente', BLOCKED: 'Bloqueada', SKIPPED: 'Omitida',
};
const externalSourceNames = Object.fromEntries(CONTINUOUS_OBJECTIVE_EXTERNAL_SOURCES.map((source) => [source.id, source.label]));
function externalSourceLiveLabel(source: ExternalSourceDisplay) {
  return source.id === 'CHATGPT_WORK' ? 'Puente local read-only observado' : 'Conector vivo · sólo lectura';
}

export function parseContinuousObjectivesSnapshot(raw: unknown): Snapshot {
  if (!raw || typeof raw !== 'object') throw new Error('Respuesta de objetivos inválida.');
  const snapshot = raw as Snapshot;
  if (!Array.isArray(snapshot.objectives) || !Array.isArray(snapshot.allowedProjects)
    || !snapshot.allowedProjects.every((name) => typeof name === 'string' && name.length > 0)) throw new Error('No se pudo observar la lista de objetivos y proyectos permitidos.');
  const externalSources = Array.isArray((raw as { externalSources?: unknown }).externalSources)
    ? (raw as { externalSources: unknown[] }).externalSources
    : [...CONTINUOUS_OBJECTIVE_EXTERNAL_SOURCES];
  if (externalSources.some((source) => !source || typeof source !== 'object'
    || typeof (source as { note?: unknown }).note !== 'string'
    || !CONTINUOUS_OBJECTIVE_EXTERNAL_SOURCES.some((known) => known.id === (source as { id?: unknown }).id
      && known.label === (source as { label?: unknown }).label
      && (known.status === (source as { status?: unknown }).status || (source as { status?: unknown }).status === 'LIVE_READONLY')))) {
    throw new Error('No se pudo observar el catálogo de fuentes externas.');
  }
  for (const item of snapshot.objectives) {
    if (!item || typeof item.id !== 'string' || !Number.isInteger(item.version) || !Number.isInteger(item.controlRevision)
      || !['ACTIVE', 'PAUSED', 'EXPIRED'].includes(item.status)
      || !Array.isArray(item.units) || !Array.isArray(item.criteria) || !Array.isArray(item.projectAllowlist)
      || typeof item.title !== 'string' || typeof item.objective !== 'string'
      || ![item.startsAt, item.endsAt, item.nextScanAt, item.createdAt, item.updatedAt].every((date) => typeof date === 'string' && Number.isFinite(Date.parse(date)))
      || (item.lastScanAt !== null && (typeof item.lastScanAt !== 'string' || !Number.isFinite(Date.parse(item.lastScanAt))))
      || !item.criteria.every((criterion) => typeof criterion === 'string') || !item.projectAllowlist.every((project) => typeof project === 'string')
      || !Number.isInteger(item.sourcesObserved) || item.sourcesObserved < 0
      || !item.counts || !COUNT_KEYS.every((key) => Number.isInteger(item.counts[key]) && item.counts[key] >= 0)) {
      throw new Error('Un objetivo no tiene estado o resultados verificables. Actualizá para reintentar.');
    }
    if (item.units.some((unit) => !unit || !unit.source || typeof unit.id !== 'string'
      || typeof unit.source.title !== 'string' || typeof unit.source.projectName !== 'string'
      || !Array.isArray(unit.resultEvidence) || !unit.resultEvidence.every((evidence) => typeof evidence === 'string')
      || ![unit.createdAt, unit.updatedAt].every((date) => typeof date === 'string' && Number.isFinite(Date.parse(date)))
      || unit.verificationScope !== 'ANALYSIS_ONLY' || unit.sourceResolved !== false)) {
      throw new Error('No se pudo verificar el alcance de los resultados de un objetivo.');
    }
  }
  return { ...snapshot, externalSources: externalSources as Snapshot['externalSources'] };
}

export function objectiveTaskProgress(objective: ContinuousObjectiveDisplay) {
  return {
    verified: objective.counts.verified,
    analyzed: objective.counts.analyzed,
    pending: objective.counts.planned + objective.counts.queued + objective.counts.needsReview + objective.counts.blocked,
    skipped: objective.counts.skipped,
  };
}

export function ContinuousObjectiveCard({ objective, disabled = false, pausing = false, onPause, onConfirmPause, onCancelPause, onResume }: {
  objective: ContinuousObjectiveDisplay; disabled?: boolean; pausing?: boolean;
  onPause?: () => void; onConfirmPause?: () => void; onCancelPause?: () => void; onResume?: () => void;
}) {
  const progress = objectiveTaskProgress(objective);
  const sources = [...new Map(objective.units.map((unit) => [unit.sourceId, unit.source])).values()];
  return (
    <article className="rounded-2xl border border-slate-800 bg-slate-950/80 p-5" aria-label={objective.title}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><span className={`rounded-full px-2.5 py-1 text-xs ${objective.status === 'ACTIVE' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-800 text-slate-300'}`}>{stateNames[objective.status]}</span><h3 className="mt-3 text-xl font-semibold">{objective.title}</h3></div>
        {objective.status === 'ACTIVE' && <Button variant="outline" disabled={disabled} onClick={onPause}><Pause className="mr-2 h-4 w-4" />Pausar</Button>}
        {objective.status === 'PAUSED' && <Button variant="outline" disabled={disabled} onClick={onResume}><Play className="mr-2 h-4 w-4" />Reanudar</Button>}
      </div>
      <p className="mt-3 whitespace-pre-wrap text-sm text-slate-300">{objective.objective}</p>
      <p className="mt-3 text-xs text-cyan-200">Responsable: Gerente General · apoyo: Sistemas y Datos</p>
      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-xl bg-slate-900 p-3"><p className="text-xs text-slate-400">Plazo</p><p>{formatCompanyOsTimestamp(objective.endsAt)}</p></div>
        <div className="rounded-xl bg-slate-900 p-3"><p className="text-xs text-slate-400">Próxima revisión</p><p>{objective.status === 'ACTIVE' ? objective.nextScanAt ? formatCompanyOsTimestamp(objective.nextScanAt) : 'Sin fecha observada' : 'No se programan nuevas tareas'}</p></div>
      </div>
      <p className="mt-2 text-xs text-slate-500">Desde {formatCompanyOsTimestamp(objective.startsAt)} · Último barrido: {objective.lastScanAt ? formatCompanyOsTimestamp(objective.lastScanAt) : 'Todavía no observado'}</p>
      {pausing && <div className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/5 p-3" role="alert"><p className="text-sm text-amber-100">Al pausar no se tomarán nuevas tareas. Una tarea que ya está corriendo puede terminar.</p><div className="mt-3 flex gap-2"><Button disabled={disabled} onClick={onConfirmPause}>Confirmar pausa</Button><Button variant="ghost" disabled={disabled} onClick={onCancelPause}>Cancelar</Button></div></div>}
      <div className="mt-5 flex flex-wrap gap-5 border-y border-slate-800 py-4">
        <div><p className="text-xl font-semibold text-emerald-300">{progress.verified}</p><p className="text-xs text-slate-400">Análisis con evidencia</p></div>
        <div><p className="text-xl font-semibold">{progress.analyzed}</p><p className="text-xs text-slate-400">Análisis de metadatos</p></div>
        <div><p className="text-xl font-semibold">{progress.pending}</p><p className="text-xs text-slate-400">Tareas pendientes</p></div>
        <div><p className="text-xl font-semibold">{objective.lastScanAt ? objective.sourcesObserved : '—'}</p><p className="text-xs text-slate-400">Fuentes observadas en el último barrido</p></div>
      </div>
      <p className="mt-2 text-xs text-slate-500">El cierre de la meta requiere comprobar sus criterios. Los análisis no cierran la tarea de origen. {progress.skipped > 0 ? `${progress.skipped} tareas omitidas quedan en el historial.` : ''}</p>
      <details className="mt-4"><summary className="cursor-pointer text-sm font-medium text-slate-200">Criterios y fuentes autorizadas</summary><ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-300">{objective.criteria.map((criterion, index) => <li key={index}>{criterion}</li>)}</ul><p className="mt-3 text-xs text-slate-400">Proyectos Codex: {objective.projectAllowlist.length ? objective.projectAllowlist.join(' · ') : 'Ninguno'}</p><p className="mt-2 text-xs text-slate-400">Fuentes externas: {objective.externalSources.length ? objective.externalSources.map((source) => externalSourceNames[source] ?? source).join(' · ') : 'Ninguna'}</p>{objective.externalSources.length > 0 && <p className="mt-2 text-xs text-emerald-300">Las fuentes externas se observan por el runtime independiente; el análisis sigue siendo read-only y no certifica cambios en la fuente.</p>}</details>
      <details className="mt-4" open={objective.units.length > 0}><summary className="cursor-pointer text-sm font-medium text-slate-200">Tareas y resultados · últimas {objective.units.length}</summary>
        {objective.units.length === 0 ? <p className="mt-3 text-sm text-slate-400">Todavía no hay tareas observadas para este objetivo.</p> : <div className="mt-3 space-y-3">{objective.units.map((unit) => <div key={unit.id} className="rounded-xl border border-slate-800 p-3"><div className="flex flex-wrap justify-between gap-2"><p className="text-sm font-medium">{unit.source.title || unit.source.projectName || 'Fuente sin título'}</p><span className="text-xs text-slate-400">{stateNames[unit.status] ?? unit.status}</span></div><p className="mt-1 text-xs text-cyan-200">{managerNames[unit.ownerAgentId] ?? 'Responsable sin identificar'} · {unit.source.projectName ?? 'Proyecto sin identificar'}</p><p className="mt-2 whitespace-pre-wrap text-sm text-slate-300">{unit.resultSummary || 'Resultado pendiente de lectura y verificación.'}</p><p className="mt-2 text-xs text-slate-500">Creada: {formatCompanyOsTimestamp(unit.createdAt)} · Última actualización: {formatCompanyOsTimestamp(unit.updatedAt)}</p><p className="mt-2 text-xs text-slate-500">{unit.caseId ? `Caso persistido: ${unit.caseId}` : 'Sin caso vinculado'}{unit.fingerprint ? ` · Huella de fuente: ${unit.fingerprint.slice(0, 12)}` : ''}</p></div>)}</div>}
      </details>
      {objective.units.some((unit)=>unit.resultEvidence.length>0) && <details className="mt-4"><summary className="cursor-pointer text-sm font-medium text-slate-200">Evidencia de los análisis</summary><ul className="mt-2 space-y-2 text-xs text-slate-400">{objective.units.filter((unit)=>unit.resultEvidence.length>0).map((unit)=><li key={unit.id}><span className="text-slate-300">{unit.source.title}: </span>{unit.resultEvidence.join(' · ')}</li>)}</ul></details>}
      <p className="mt-4 text-xs text-slate-500">Fuentes visibles en estas tareas: {sources.length ? sources.slice(0, 6).map((source) => source.title || source.projectName || source.kind || 'Sin identificar').join(' · ') : 'Ninguna todavía'}</p>
    </article>
  );
}

export function CompanyOsContinuousObjectives() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [current, setCurrent] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [pauseTarget, setPauseTarget] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [durationDays, setDurationDays] = useState(30);
  const [projects, setProjects] = useState<string[]>([]);
  const [externalSources, setExternalSources] = useState<ContinuousObjectiveExternalSourceId[]>([]);
  const [criteria, setCriteria] = useState('');
  const requestSequence = useRef(0);
  const mutationKey = useRef<{ fingerprint: string; key: string } | null>(null);

  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current;
    try {
      const response = await fetch(ENDPOINT, { cache:'no-store', signal:AbortSignal.timeout(12_000) });
      const raw = await response.json().catch(() => null);
      if (!response.ok) throw new Error(raw?.error || 'No se pudo leer el estado de los objetivos.');
      const next = parseContinuousObjectivesSnapshot(raw);
      if (sequence === requestSequence.current) { setSnapshot(next); setCurrent(true); setError(''); }
      return next;
    } catch (cause) {
      if (sequence === requestSequence.current) { setCurrent(false); setError(cause instanceof Error ? cause.message : 'No se pudo leer el estado de los objetivos.'); }
      throw cause;
    }
  }, []);

  useEffect(() => {
    void refresh().catch(() => {});
    const timer = window.setInterval(() => void refresh().catch(() => {}), 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function mutate(payload: Record<string, unknown>) {
    const fingerprint = JSON.stringify(payload);
    if (mutationKey.current?.fingerprint !== fingerprint) mutationKey.current = { fingerprint, key:`objectives:${crypto.randomUUID()}` };
    const response = await fetch(ENDPOINT, {
      method:'POST', headers:{'content-type':'application/json'},
      body:JSON.stringify({ ...payload, idempotencyKey:mutationKey.current.key }),
      signal:AbortSignal.timeout(60_000),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error || 'No se pudo confirmar la operación. Reintentá sin cambiar los datos.');
    if (typeof result?.objective?.id !== 'string') throw new Error('La operación no devolvió un objetivo verificable.');
    const readback = await refresh();
    const saved = readback.objectives.find((item) => item.id === result.objective.id);
    const expectedStatus = payload.action === 'PAUSE' ? 'PAUSED' : 'ACTIVE';
    if (!saved || saved.status !== expectedStatus) throw new Error('La operación respondió, pero el estado esperado no aparece en la lectura posterior.');
    mutationKey.current = null;
    return saved;
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (busy || !current) return;
    setBusy('CREATE'); setError(''); setNotice('');
    try {
      await mutate({action:'CREATE',title:title.trim(),objective:objective.trim(),durationDays,projectAllowlist:projects,externalSources,criteria:criteria.split('\n').map((item)=>item.trim()).filter(Boolean)});
      setTitle(''); setObjective(''); setCriteria(''); setProjects([]); setExternalSources([]); setPauseTarget(null);
      setNotice('Objetivo creado y activo. El próximo barrido observará el alcance elegido y dejará bloqueadas las fuentes sin conector.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo confirmar la creación.'); }
    finally { setBusy(null); }
  }

  async function control(item: ContinuousObjectiveDisplay, action: 'PAUSE' | 'RESUME') {
    if (busy || !current) return;
    setBusy(item.id); setError(''); setNotice('');
    try {
      await mutate({action,objectiveId:item.id,expectedVersion:item.version,expectedControlRevision:item.controlRevision});
      setPauseTarget(null);
      setNotice(action === 'PAUSE' ? 'Objetivo pausado. Las tareas que ya corrían pueden terminar.' : 'Objetivo reanudado y confirmado.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo confirmar el cambio.'); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-5">
      {error && <div role="alert" className="rounded-xl border border-red-500/30 bg-red-950/20 p-4 text-sm text-red-200">{error}{snapshot && !current ? ' Se muestra la última lectura disponible; los controles están deshabilitados.' : ''}</div>}
      {notice && <p role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3 text-sm text-emerald-200">{notice}</p>}
      <div className="grid items-start gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <form onSubmit={(event)=>void create(event)} className="space-y-4 rounded-2xl border border-cyan-400/20 bg-slate-950 p-5">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><Target className="h-5 w-5 text-cyan-300" />Nuevo objetivo</h2>
          <label className="block text-sm">Título<Input required minLength={3} maxLength={160} value={title} onChange={(event)=>setTitle(event.target.value)} className="mt-1" placeholder="Reducir pendientes de calidad de datos" /></label>
          <label className="block text-sm">Resultado que querés lograr<Textarea required minLength={10} maxLength={4000} value={objective} onChange={(event)=>setObjective(event.target.value)} className="mt-1 min-h-28" placeholder="Describí qué debe mejorar y qué resultado esperás." /></label>
          <label className="block text-sm">Duración en días<Input type="number" required min={1} max={30} value={durationDays} onChange={(event)=>setDurationDays(Number(event.target.value))} className="mt-1" /><span className="mt-1 block text-xs text-slate-500">De 1 a 30 días. Sin renovación automática.</span></label>
          <fieldset className="space-y-2"><legend className="mb-2 text-sm">Proyectos Codex permitidos (opcional)</legend>{snapshot?.allowedProjects.map((project)=><label key={project} className="flex items-start gap-2 text-sm text-slate-300"><input type="checkbox" checked={projects.includes(project)} onChange={(event)=>setProjects((selected)=>event.target.checked?[...selected,project]:selected.filter((value)=>value!==project))} className="mt-1 accent-cyan-400" />{project}</label>)}{!snapshot ? <p className="text-xs text-slate-400">Cargando proyectos del servidor…</p> : snapshot.allowedProjects.length === 0 ? <p className="text-xs text-amber-300">No hay proyectos permitidos configurados.</p> : null}</fieldset>
          <fieldset className="space-y-2"><legend className="mb-2 text-sm">Fuentes externas de sólo lectura (opcional)</legend>{(snapshot?.externalSources ?? (CONTINUOUS_OBJECTIVE_EXTERNAL_SOURCES as unknown as ExternalSourceDisplay[])).map((source)=><label key={source.id} className="flex items-start gap-2 text-sm text-slate-300"><input type="checkbox" checked={externalSources.includes(source.id)} onChange={(event)=>setExternalSources((selected)=>event.target.checked?[...selected,source.id]:selected.filter((value)=>value!==source.id))} className="mt-1 accent-cyan-400" /><span>{source.label}<span className={`block text-xs ${source.status === 'LIVE_READONLY' ? 'text-emerald-300' : 'text-amber-300'}`}>{source.status === 'LIVE_READONLY' ? externalSourceLiveLabel(source) : source.status === 'BLOCKED_REQUIRES_READONLY_BRIDGE' ? 'Requiere puente read-only' : 'Requiere conector del runtime'}</span></span></label>)}</fieldset>
          <label className="block text-sm">Criterios para darlo por cumplido<Textarea required value={criteria} maxLength={6012} onChange={(event)=>setCriteria(event.target.value)} className="mt-1 min-h-28" placeholder={'Un criterio por línea.\nEj.: Cada incidencia tiene fuente y resultado verificado.'} /><span className="mt-1 block text-xs text-slate-500">Hasta 12 criterios, de 3 a 500 caracteres cada uno.</span></label>
          <p className="text-xs text-slate-400">El Gerente General coordina a Sistemas y Datos dentro del alcance elegido. Se mantienen los límites de 48.000 tokens diarios y 1.000.000 mensuales por gerente.</p>
          <Button type="submit" disabled={!!busy || !current || (projects.length===0 && externalSources.length===0)} className="w-full bg-cyan-400 text-slate-950 hover:bg-cyan-300">{busy==='CREATE'?<Loader2 className="mr-2 h-4 w-4 animate-spin" />:<Play className="mr-2 h-4 w-4" />}Crear y activar</Button>
        </form>
        <section className="space-y-4" aria-label="Objetivos y resultados">
          <div className="flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-lg font-semibold"><CalendarClock className="h-5 w-5 text-cyan-300" />Objetivos y resultados</h2><Button variant="outline" size="sm" disabled={!!busy} onClick={()=>void refresh().catch(()=>{})}><RefreshCw className="mr-2 h-4 w-4" />Actualizar</Button></div>
          {!snapshot ? <p className="rounded-xl border border-slate-800 p-5 text-sm text-slate-400">{error?'Estado sin observar. Usá Actualizar para reintentar.':'Leyendo objetivos…'}</p> : snapshot.objectives.length===0 ? <div className="rounded-xl border border-slate-800 p-6"><CheckCircle2 className="mb-2 h-5 w-5 text-slate-500" /><p className="text-sm text-slate-400">Todavía no hay objetivos continuos. Creá el primero con los proyectos y criterios que querés trabajar.</p></div> : snapshot.objectives.map((item)=><ContinuousObjectiveCard key={item.id} objective={item} disabled={!!busy||!current} pausing={pauseTarget===item.id} onPause={()=>setPauseTarget(item.id)} onCancelPause={()=>setPauseTarget(null)} onConfirmPause={()=>void control(item,'PAUSE')} onResume={()=>void control(item,'RESUME')} />)}
          <p className="text-xs text-slate-500">Lectura automática cada 15 segundos. Las fuentes y resultados se muestran sólo después de persistirse.</p>
        </section>
      </div>
    </div>
  );
}
