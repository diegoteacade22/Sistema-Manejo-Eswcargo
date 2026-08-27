"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BadgeDollarSign,
  Bot,
  CheckCircle2,
  CircleHelp,
  Clock3,
  ExternalLink,
  Loader2,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const URL = "/api/company-os/dashboard/human";
const POLL_MS = 30_000;

type Task = {
  threadId: string;
  title: string;
  projectName: string;
  category: string;
  humanStatus: string;
  priority: number;
  nextAction: string;
  attentionReason: string | null;
  autonomyLevel: string;
  codexUrl: string;
  sourceUpdatedAt: string;
};

type Idea = {
  sku: string;
  product: string;
  stock: number;
  costUsd: number;
  suggestedPriceUsd: number;
  marginPct: number;
  reason: string;
  evidence: string;
  observedAt: string;
};

type Snapshot = {
  generatedAt: string;
  summary: Record<string, number>;
  now: Task[];
  pending: Task[];
  needsDiego: Task[];
  blocked: Task[];
  readyReview: Task[];
  done: Task[];
  monitoring: Task[];
  commercialIdeas: Idea[];
  commercialNextAction: null | { title: string; detail: string; href: string };
  activity: null | {
    sourceHost: string;
    lastScanAt: string;
    observedCount: number;
    changedInLastScan: number;
    changesToday: number;
    fresh: boolean;
  };
};

type SectionId = "now" | "pending" | "needsDiego" | "blocked" | "readyReview" | "monitoring" | "commercial" | "done";

export const SECTION_HASHES: Record<SectionId, string> = {
  now: "trabajando-ahora",
  pending: "para-el-agente",
  needsDiego: "necesito-de-vos",
  blocked: "con-problemas",
  readyReview: "listas-para-revisar",
  monitoring: "monitoreos-activos",
  commercial: "ideas-y-ofertas",
  done: "realizadas",
};

export function sectionFromHash(hash: string): SectionId | null {
  const normalized = hash.replace(/^#/, "");
  return (Object.entries(SECTION_HASHES).find(([, value]) => value === normalized)?.[0] as SectionId | undefined) ?? null;
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function relativeTime(value: string) {
  const diff = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(diff)) return "sin fecha";
  if (diff < 60_000) return "recién";
  if (diff < 3_600_000) return `hace ${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000) return `hace ${Math.floor(diff / 3_600_000)} h`;
  return `hace ${Math.floor(diff / 86_400_000)} días`;
}

function TaskCard({ task, accent = "border-slate-800", onDone, saving }: {
  task: Task; accent?: string; onDone?: (threadId: string) => void; saving?: boolean;
}) {
  return (
    <div className={`rounded-2xl border ${accent} bg-slate-950/60 p-4 transition hover:border-cyan-400/50`}>
      <a href={task.codexUrl} className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400" aria-label={`Abrir tarea ${task.title} en Codex`}>
        <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold leading-snug text-slate-100">{task.title}</p>
          <p className="mt-1 text-xs text-slate-500">{task.projectName} · {relativeTime(task.sourceUpdatedAt)}</p>
        </div>
        <ExternalLink aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-slate-600" />
        </div>
        {task.attentionReason && <p className="mt-3 text-sm text-amber-200">{task.attentionReason}</p>}
        <p className="mt-3 text-sm text-slate-300"><span className="text-slate-500">Próximo paso:</span> {task.nextAction}</p>
        <p className="mt-3 text-sm font-medium text-cyan-300">Abrir tarea en Codex →</p>
      </a>
      <div className="mt-3 flex flex-wrap gap-2">
        <Badge variant="outline" className="border-slate-700 text-slate-400">Prioridad {task.priority}</Badge>
        <Badge variant="outline" className="border-slate-700 text-slate-400">{task.autonomyLevel === "HUMAN" ? "Requiere persona" : `Agente ${task.autonomyLevel}`}</Badge>
        {onDone && <Button size="sm" className="ml-auto bg-emerald-600 text-white hover:bg-emerald-500" disabled={saving} aria-busy={saving} onClick={() => onDone(task.threadId)}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />} Marcar realizada
        </Button>}
      </div>
    </div>
  );
}

function TaskSection({ title, description, tasks, empty, accent, onDone, savingThreadId }: {
  title: string; description: string; tasks: Task[]; empty: string; accent?: string;
  onDone?: (threadId: string) => void; savingThreadId?: string | null;
}) {
  return (
    <Card className="border-slate-800 bg-slate-950/70 text-slate-100">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-lg">{title}</CardTitle>
            <CardDescription className="mt-1 text-slate-500">{description}</CardDescription>
          </div>
          <Badge className="bg-slate-800 text-slate-200">{tasks.length}</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 xl:grid-cols-2">
        {tasks.length ? tasks.map((task) => <TaskCard key={task.threadId} task={task} accent={accent} onDone={onDone} saving={savingThreadId === task.threadId} />) : <p className="text-sm text-slate-500">{empty}</p>}
      </CardContent>
    </Card>
  );
}

function CommercialSection({ snapshot }: { snapshot: Snapshot | null }) {
  return (
    <Card className="border-emerald-500/20 bg-slate-950/70 text-slate-100">
      <CardHeader>
        <div className="flex items-center gap-3"><Sparkles className="h-5 w-5 text-emerald-300" /><div><CardTitle className="text-lg">Ideas y ofertas</CardTitle><CardDescription className="text-slate-500">Precios basados en stock, último costo y lista LP1 reales. Son sugerencias; no se publican solas.</CardDescription></div></div>
      </CardHeader>
      <CardContent className="grid gap-3 xl:grid-cols-2">
        {(snapshot?.commercialIdeas ?? []).map((idea) => (
          <Link key={idea.sku} href="/products" className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 transition hover:border-emerald-400/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">
            <div className="flex items-start justify-between gap-3">
              <div><p className="font-semibold">{idea.product}</p><p className="mt-1 text-xs text-slate-500">{idea.sku} · {idea.stock} en stock</p></div>
              <BadgeDollarSign className="h-5 w-5 text-emerald-300" />
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div><p className="text-xs text-slate-500">Costo</p><p className="font-bold">{money(idea.costUsd)}</p></div>
              <div><p className="text-xs text-slate-500">Oferta sugerida</p><p className="font-bold text-emerald-300">{money(idea.suggestedPriceUsd)}</p></div>
              <div><p className="text-xs text-slate-500">Margen</p><p className="font-bold">{idea.marginPct}%</p></div>
            </div>
            <p className="mt-3 text-sm text-slate-400">{idea.reason}</p>
            <p className="mt-2 text-xs text-slate-600">Fuente: {idea.evidence}</p>
            <p className="mt-3 text-sm font-medium text-cyan-300">Abrir artículos →</p>
          </Link>
        ))}
        {!snapshot?.commercialIdeas?.length && snapshot?.commercialNextAction && (
          <Link href={snapshot.commercialNextAction.href} className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 transition hover:border-amber-400/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400">
            <p className="font-semibold text-amber-200">{snapshot.commercialNextAction.title}</p>
            <p className="mt-2 text-sm text-slate-400">{snapshot.commercialNextAction.detail}</p>
            <p className="mt-3 text-sm text-cyan-300">Abrir artículos para completarlo →</p>
          </Link>
        )}
        {!snapshot?.commercialIdeas?.length && !snapshot?.commercialNextAction && <p className="text-sm text-slate-500">No hay una oferta con costo, stock y precio verificables todavía.</p>}
      </CardContent>
    </Card>
  );
}

export function CompanyOsHumanDashboard() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingThreadId, setSavingThreadId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<SectionId | null>(null);
  const [navigationRequest, setNavigationRequest] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(URL, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setSnapshot(await response.json());
      setError(null);
    } catch {
      setError("No pude leer el inventario de tareas. El diagnóstico técnico sigue disponible abajo.");
    } finally {
      setLoading(false);
    }
  }, []);

  const markDone = useCallback(async (threadId: string) => {
    setSavingThreadId(threadId);
    try {
      const response = await fetch(URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "MARK_DONE", threadId }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await refresh();
    } catch {
      setError("No pude marcar la tarea como realizada. Abrila para revisar el resultado e intentá nuevamente.");
    } finally {
      setSavingThreadId(null);
    }
  }, [refresh]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    const syncSectionWithHash = () => {
      const section = sectionFromHash(window.location.hash);
      setActiveSection(section);
      if (section) setNavigationRequest((current) => current + 1);
    };
    syncSectionWithHash();
    window.addEventListener("hashchange", syncSectionWithHash);
    window.addEventListener("popstate", syncSectionWithHash);
    return () => {
      window.removeEventListener("hashchange", syncSectionWithHash);
      window.removeEventListener("popstate", syncSectionWithHash);
    };
  }, []);

  useEffect(() => {
    if (!activeSection || loading) return;
    const frame = window.requestAnimationFrame(() => {
      const panel = document.getElementById("dashboard-detail-panel");
      if (!panel) return;
      panel.focus({ preventScroll: true });
      const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      panel.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeSection, loading, navigationRequest]);

  const openSection = useCallback((section: SectionId) => {
    setActiveSection(section);
    setNavigationRequest((current) => current + 1);
    window.history.pushState(null, "", `#${SECTION_HASHES[section]}`);
  }, []);

  const closeSection = useCallback(() => {
    const controlId = activeSection ? `control-${activeSection}` : null;
    setActiveSection(null);
    window.history.pushState(null, "", `${window.location.pathname}${window.location.search}`);
    window.requestAnimationFrame(() => {
      if (controlId) document.getElementById(controlId)?.focus();
    });
  }, [activeSection]);

  const summary = useMemo(() => [
    { section: "now" as const, label: "Trabajando", value: snapshot?.summary.inProgress ?? 0, className: "text-cyan-300" },
    { section: "pending" as const, label: "Para el agente", value: (snapshot?.summary.pending ?? 0) + (snapshot?.summary.unreviewed ?? 0), className: "text-slate-100" },
    { section: "needsDiego" as const, label: "Necesito de vos", value: snapshot?.summary.needsDiego ?? 0, className: "text-amber-300" },
    { section: "blocked" as const, label: "Con problemas", value: snapshot?.summary.blocked ?? 0, className: "text-rose-300" },
    { section: "readyReview" as const, label: "Listas para revisar", value: snapshot?.summary.readyReview ?? 0, className: "text-violet-300" },
    { section: "done" as const, label: "Realizadas", value: snapshot?.summary.done ?? 0, className: "text-emerald-300" },
    { section: "monitoring" as const, label: "Monitoreos activos", value: snapshot?.monitoring.length ?? 0, className: "text-cyan-200" },
    { section: "commercial" as const, label: "Ideas y ofertas", value: snapshot ? Math.max(snapshot.commercialIdeas.length, snapshot.commercialNextAction ? 1 : 0) : 0, className: "text-emerald-200" },
  ], [snapshot]);

  const activePanel = (() => {
    switch (activeSection) {
      case "now": return <TaskSection title="Trabajando ahora" description="Tareas que tienen una ejecución activa." tasks={snapshot?.now ?? []} empty="No hay una tarea activa en este momento." accent="border-cyan-500/25" />;
      case "needsDiego": return <TaskSection title="Necesito que decidas" description="Decisiones, permisos o datos que sólo vos podés dar." tasks={snapshot?.needsDiego ?? []} empty="No hay decisiones tuyas pendientes." accent="border-amber-500/25" />;
      case "pending": return <TaskSection title="El agente puede trabajar ahora" description="Backlog priorizado para retomar sin una acción externa." tasks={snapshot?.pending ?? []} empty="No hay tareas listas para tomar." />;
      case "blocked": return <TaskSection title="Con problemas" description="Bloqueos por accesos, proveedores o dependencias externas." tasks={snapshot?.blocked ?? []} empty="No hay bloqueos detectados." accent="border-rose-500/25" />;
      case "readyReview": return <TaskSection title="Listas para que revises" description="Hay resultado y evidencia; abrí la tarea y, si está bien, marcala realizada." tasks={snapshot?.readyReview ?? []} empty="No hay resultados esperando revisión." accent="border-violet-500/25" onDone={markDone} savingThreadId={savingThreadId} />;
      case "monitoring": return <TaskSection title="Monitoreos activos" description="Controles recurrentes que el agente mantiene bajo observación." tasks={snapshot?.monitoring ?? []} empty="No hay monitoreos activos." accent="border-cyan-500/20" />;
      case "commercial": return <CommercialSection snapshot={snapshot} />;
      case "done": return <TaskSection title="Realizadas" description="Sólo resultados validados; una respuesta de Codex no alcanza para entrar acá." tasks={snapshot?.done ?? []} empty="Todavía no hay tareas marcadas como realizadas con validación." accent="border-emerald-500/25" />;
      default: return null;
    }
  })();

  if (loading && !snapshot) return <div className="flex min-h-64 items-center justify-center text-slate-400"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Leyendo tareas de Codex…</div>;

  return (
    <div className="space-y-6">
      {error && <div role="alert" className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Resumen de tareas">
        {summary.map((item) => (
          <a
            key={item.section}
            id={`control-${item.section}`}
            href={`#${SECTION_HASHES[item.section]}`}
            aria-expanded={activeSection === item.section}
            aria-controls="dashboard-detail-panel"
            onClick={(event) => { event.preventDefault(); openSection(item.section); }}
            className="group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          >
            <Card className={`h-full transition ${activeSection === item.section ? "border-cyan-400 bg-cyan-500/10" : "border-slate-800 bg-slate-950/70 group-hover:border-slate-600"}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div><p className={`text-3xl font-black ${item.className}`}>{item.value}</p><p className="mt-1 text-xs text-slate-500">{item.label}</p></div>
                  <span className="text-xs font-medium text-cyan-300">Ver →</span>
                </div>
              </CardContent>
            </Card>
          </a>
        ))}
      </section>

      <section className="rounded-3xl border border-cyan-500/20 bg-gradient-to-r from-cyan-500/10 via-slate-950 to-emerald-500/5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <Bot className="mt-1 h-6 w-6 text-cyan-300" />
            <div>
              <h2 className="font-bold text-slate-100">Agente 24/7</h2>
              {snapshot?.activity ? (
                <p className="mt-1 text-sm text-slate-400">
                  {snapshot.activity.observedCount} tareas raíz revisadas · {snapshot.activity.changedInLastScan} cambiaron · último escaneo {relativeTime(snapshot.activity.lastScanAt)}
                </p>
              ) : <p className="mt-1 text-sm text-amber-300">Esperando el primer escaneo del inventario Codex.</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge className={snapshot?.activity?.fresh ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}>
              {snapshot?.activity?.fresh ? "AL DÍA" : "SIN DATOS FRESCOS"}
            </Badge>
            <Button size="sm" variant="outline" onClick={() => void refresh()}><RefreshCw className="mr-2 h-4 w-4" /> Actualizar</Button>
          </div>
        </div>
      </section>

      <section
        id="dashboard-detail-panel"
        role="region"
        aria-label={!activeSection ? "Detalle de la categoría elegida" : undefined}
        aria-labelledby={activeSection ? `control-${activeSection}` : undefined}
        tabIndex={-1}
        className="scroll-mt-24 space-y-3 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
      >
        {activePanel ? (
          <>
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-3">
              <p className="text-sm text-slate-400">Mostrando solamente <span className="font-medium text-slate-100">{summary.find((item) => item.section === activeSection)?.label}</span>.</p>
              <Button size="sm" variant="ghost" onClick={closeSection}><X className="mr-2 h-4 w-4" /> Ocultar detalle</Button>
            </div>
            {activePanel}
          </>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/40 p-6 text-center text-sm text-slate-400">
            Hacé clic en cualquiera de los cuadros para abrir solamente esa lista.
          </div>
        )}
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4 text-sm text-slate-400"><Clock3 className="mb-2 h-5 w-5 text-cyan-300" />Escaneo automático cada 5 minutos.</div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4 text-sm text-slate-400"><CircleHelp className="mb-2 h-5 w-5 text-amber-300" />Si falta una decisión, el agente no improvisa.</div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4 text-sm text-slate-400"><CheckCircle2 className="mb-2 h-5 w-5 text-emerald-300" />“Realizada” exige evidencia y revisión.</div>
      </section>
    </div>
  );
}
