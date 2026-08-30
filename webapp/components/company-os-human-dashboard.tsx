"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Archive,
  BadgeDollarSign,
  Bot,
  CheckCircle2,
  CircleHelp,
  Clock3,
  ExternalLink,
  Loader2,
  MoveRight,
  RefreshCw,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const URL = "/api/company-os/dashboard/human";
const POLL_MS = 30_000;

type Task = {
  threadId: string;
  title: string;
  projectName: string;
  category: string;
  humanStatus: string;
  sourceHumanStatus: string;
  sourceArchived: boolean;
  sourceProjectName: string;
  lifecycle: "OPEN" | "CLOSED" | "ARCHIVED";
  priority: number;
  nextAction: string;
  attentionReason: string | null;
  autonomyLevel: string;
  codexUrl: string;
  sourceStatus: string;
  fingerprint: string;
  boardVersion: number;
  boardUpdatedAt: string | null;
  changedSinceManaged: boolean;
  nativeMutationAvailable: boolean;
  autoResumeApproved: boolean;
  autoResumeRunning: boolean;
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
  unreviewed: Task[];
  pending: Task[];
  needsDiego: Task[];
  blocked: Task[];
  readyReview: Task[];
  done: Task[];
  monitoring: Task[];
  archived: Task[];
  projects: Array<{ name: string; count: number }>;
  commercialIdeas: Idea[];
  commercialNextAction: null | { title: string; detail: string; href: string };
  activity: null | {
    sourceHost: string;
    lastScanAt: string;
    observedCount: number;
    changedInLastScan: number;
    changesToday: number;
    fresh: boolean;
    autoResumeEnabled: boolean;
  };
};

type SectionId = "now" | "unreviewed" | "pending" | "needsDiego" | "blocked" | "readyReview" | "monitoring" | "commercial" | "done" | "archived";
type ManagementAction = "MOVE" | "MOVE_PROJECT" | "ARCHIVE" | "CLOSE" | "REOPEN";

export const SECTION_HASHES: Record<SectionId, string> = {
  now: "trabajando-ahora",
  unreviewed: "sin-revisar",
  pending: "para-el-agente",
  needsDiego: "necesito-de-vos",
  blocked: "con-problemas",
  readyReview: "listas-para-revisar",
  monitoring: "monitoreos-activos",
  commercial: "ideas-y-ofertas",
  done: "realizadas",
  archived: "archivadas",
};

const WORKFLOW_OPTIONS = [
  { value: "PENDING", label: "Para el agente" },
  { value: "NEEDS_DIEGO", label: "Necesito de vos" },
  { value: "BLOCKED", label: "Con problemas" },
  { value: "READY_REVIEW", label: "Lista para revisar" },
  { value: "MONITORING", label: "Monitoreo activo" },
] as const;

const STATUS_LABELS: Record<string, string> = {
  UNREVIEWED: "Sin revisar",
  PENDING: "Para el agente",
  IN_PROGRESS: "Trabajando ahora",
  NEEDS_DIEGO: "Necesito de vos",
  BLOCKED: "Con problemas",
  READY_REVIEW: "Lista para revisar",
  DONE: "Realizada",
  MONITORING: "Monitoreo activo",
  DISCARDED: "Descartada",
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

function findSnapshotTask(snapshot: Snapshot, threadId: string) {
  return [snapshot.now, snapshot.unreviewed, snapshot.pending, snapshot.needsDiego, snapshot.blocked, snapshot.readyReview, snapshot.done, snapshot.monitoring, snapshot.archived]
    .flat()
    .find((task) => task.threadId === threadId) ?? null;
}

function moveTargetForTask(task: Task) {
  if (task.lifecycle !== "OPEN") return "PENDING";
  return WORKFLOW_OPTIONS.some((option) => option.value === task.humanStatus) ? task.humanStatus : "PENDING";
}

function TaskCard({ task, accent = "border-slate-800", onOpen }: {
  task: Task; accent?: string; onOpen: (task: Task) => void;
}) {
  return (
    <div className={`rounded-2xl border ${accent} bg-slate-950/60 p-4 transition hover:border-cyan-400/50`}>
      <button type="button" onClick={() => onOpen(task)} className="block w-full rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400" aria-label={`Ver y gestionar ${task.title} en este tablero`}>
        <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold leading-snug text-slate-100">{task.title}</p>
          <p className="mt-1 text-xs text-slate-500">{task.projectName} · {relativeTime(task.sourceUpdatedAt)}</p>
        </div>
        <MoveRight aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-slate-600" />
        </div>
        {task.attentionReason && <p className="mt-3 text-sm text-amber-200">{task.attentionReason}</p>}
        <p className="mt-3 text-sm text-slate-300"><span className="text-slate-500">Próximo paso:</span> {task.nextAction}</p>
        <p className="mt-3 text-sm font-medium text-cyan-300">Ver y gestionar acá →</p>
      </button>
      <div className="mt-3 flex flex-wrap gap-2">
        <Badge variant="outline" className="border-slate-700 text-slate-400">Prioridad {task.priority}</Badge>
        <Badge variant="outline" className="border-slate-700 text-slate-400">{task.autonomyLevel === "HUMAN" ? "Requiere persona" : `Agente ${task.autonomyLevel}`}</Badge>
        {task.autoResumeApproved && <Badge className="bg-emerald-500/15 text-emerald-300">Reanudación automática aprobada</Badge>}
      </div>
    </div>
  );
}

function TaskSection({ title, description, tasks, empty, accent, onOpenTask }: {
  title: string; description: string; tasks: Task[]; empty: string; accent?: string;
  onOpenTask: (task: Task) => void;
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
        {tasks.length ? tasks.map((task) => <TaskCard key={task.threadId} task={task} accent={accent} onOpen={onOpenTask} />) : <p className="text-sm text-slate-500">{empty}</p>}
      </CardContent>
    </Card>
  );
}

function TaskManagerDialog({
  task,
  projects,
  moveTarget,
  setMoveTarget,
  projectTarget,
  setProjectTarget,
  savingAction,
  confirmation,
  setConfirmation,
  error,
  notice,
  autoResumeReady,
  onOpenChange,
  onAction,
}: {
  task: Task | null;
  projects: Array<{ name: string; count: number }>;
  moveTarget: string;
  setMoveTarget: (value: string) => void;
  projectTarget: string;
  setProjectTarget: (value: string) => void;
  savingAction: ManagementAction | null;
  confirmation: "ARCHIVE" | "CLOSE" | "AUTO_RESUME" | null;
  setConfirmation: (action: "ARCHIVE" | "CLOSE" | "AUTO_RESUME" | null) => void;
  error: string | null;
  notice: string | null;
  autoResumeReady: boolean;
  onOpenChange: (open: boolean) => void;
  onAction: (action: ManagementAction, targetStatus?: string, confirmed?: boolean, targetProjectName?: string) => void;
}) {
  const isOpen = task?.lifecycle === "OPEN";
  const canClose = isOpen && task?.humanStatus === "READY_REVIEW";
  const canReopen = Boolean(task && (!isOpen || ["DONE", "DISCARDED"].includes(task.humanStatus)));
  const canAuthorizeAutoResume = Boolean(task && !task.sourceArchived && !task.attentionReason && ["IDLE", "NOT_LOADED"].includes(task.sourceStatus) && !task.autoResumeRunning);
  const options = canReopen ? WORKFLOW_OPTIONS.filter((option) => ["PENDING", "NEEDS_DIEGO"].includes(option.value)) : WORKFLOW_OPTIONS;
  const projectOptions = projects;

  return (
    <Dialog open={Boolean(task)} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="max-h-[90dvh] overflow-y-auto border-slate-700 bg-slate-950 text-slate-100 sm:max-w-2xl" aria-busy={Boolean(savingAction)}>
        {task && <>
          <DialogHeader>
            <DialogTitle className="pr-8 text-xl leading-snug">{task.title}</DialogTitle>
            <DialogDescription className="text-slate-400">{task.projectName} · actualizada {relativeTime(task.sourceUpdatedAt)}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
              <p className="text-xs text-slate-500">Estado en el tablero</p>
              <p className="mt-1 font-semibold text-cyan-200">{task.lifecycle === "ARCHIVED" ? "Archivada" : STATUS_LABELS[task.humanStatus] ?? task.humanStatus}</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
              <p className="text-xs text-slate-500">Prioridad</p>
              <p className="mt-1 font-semibold">{task.priority}</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
              <p className="text-xs text-slate-500">Responsable</p>
              <p className="mt-1 font-semibold">{task.autonomyLevel === "HUMAN" ? "Persona" : `Agente ${task.autonomyLevel}`}</p>
            </div>
          </div>

          {task.attentionReason && <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-100"><span className="font-semibold">Qué necesita:</span> {task.attentionReason}</div>}
          {task.autoResumeApproved && <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-100"><span className="font-semibold">Autorizada para reanudación automática.</span> {autoResumeReady ? "El modo autónomo está habilitado y la tomará en un próximo ciclo, de a una tarea por vez." : "La autorización quedó guardada, pero todavía no hay un inventario autónomo reciente."}</div>}
          {task.changedSinceManaged && <div className="rounded-xl border border-violet-500/30 bg-violet-500/10 p-3 text-sm text-violet-100"><span className="font-semibold">Codex agregó actividad después del último cambio manual.</span> La clasificación automática volvió a actualizarse para que no se pierda nada.</div>}
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <p className="text-xs text-slate-500">Próximo paso</p>
            <p className="mt-2 text-sm text-slate-200">{task.nextAction}</p>
          </div>

          {error && <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div>}
          {notice && <div role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">{notice}</div>}

          {task.autoResumeRunning ? (
            <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-4 text-sm text-cyan-100">
              <span className="font-semibold">Codex está ejecutando esta tarea.</span> Para no confundir el estado ni perder el readback, mover, archivar y cerrar quedan bloqueados hasta que termine o venza el límite de seguridad.
            </div>
          ) : confirmation ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
              <p className="font-semibold text-amber-100">{confirmation === "AUTO_RESUME" ? "¿Autorizar que Codex reanude este hilo?" : confirmation === "CLOSE" ? "¿Confirmás que revisaste el resultado?" : "¿Archivar esta tarea en el tablero?"}</p>
              <p className="mt-1 text-sm text-slate-300">{confirmation === "AUTO_RESUME" ? "Agregará una nueva ejecución dentro del alcance original, con sandbox, una tarea por vez y sin efectos externos nuevos no autorizados." : confirmation === "CLOSE" ? "Quedará como realizada. Después podés reabrirla." : "Se ocultará de las listas activas, pero conservará su historial."}</p>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <Button variant="ghost" disabled={Boolean(savingAction)} onClick={() => setConfirmation(null)}>Cancelar</Button>
                <Button
                  className={confirmation === "CLOSE" ? "bg-emerald-600 text-white hover:bg-emerald-500" : confirmation === "AUTO_RESUME" ? "bg-cyan-600 text-white hover:bg-cyan-500" : "bg-amber-600 text-white hover:bg-amber-500"}
                  disabled={Boolean(savingAction)}
                  onClick={() => confirmation === "AUTO_RESUME" ? onAction(canReopen ? "REOPEN" : "MOVE", "PENDING", true) : onAction(confirmation, undefined, confirmation === "CLOSE")}
                >
                  {savingAction ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : confirmation === "CLOSE" ? <CheckCircle2 className="mr-2 h-4 w-4" /> : confirmation === "AUTO_RESUME" ? <Bot className="mr-2 h-4 w-4" /> : <Archive className="mr-2 h-4 w-4" />}
                  {confirmation === "AUTO_RESUME" ? "Sí, autorizar y reanudar" : confirmation === "CLOSE" ? "Sí, cerrar como realizada" : "Sí, archivar"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3 rounded-xl border border-slate-800 p-4">
              <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                <div className="space-y-2">
                  <Label htmlFor="task-destination">{canReopen ? "Reabrir en" : "Mover en este tablero a"}</Label>
                  <Select value={moveTarget} onValueChange={setMoveTarget} disabled={Boolean(savingAction)}>
                    <SelectTrigger id="task-destination" className="w-full border-slate-700 bg-slate-900"><SelectValue /></SelectTrigger>
                    <SelectContent>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <Button variant="outline" disabled={Boolean(savingAction) || (moveTarget === "PENDING" && !canAuthorizeAutoResume)} onClick={() => moveTarget === "PENDING" ? setConfirmation("AUTO_RESUME") : onAction(canReopen ? "REOPEN" : "MOVE", moveTarget)}>
                  {savingAction ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : canReopen ? <RotateCcw className="mr-2 h-4 w-4" /> : <MoveRight className="mr-2 h-4 w-4" />}
                  {moveTarget === "PENDING" ? "Autorizar y reanudar" : canReopen ? "Reabrir" : "Mover"}
                </Button>
              </div>
              <p className="text-xs text-slate-500">Las tareas recientes interrumpidas entran solas. Mover una tarea antigua a “Para el agente” autoriza una nueva ejecución. “Trabajando ahora” aparece cuando Codex la toma.</p>
              {moveTarget === "PENDING" && !canAuthorizeAutoResume && <p className="text-xs text-amber-300">Primero resolvé la decisión o ejecución activa indicada arriba; el reanudador no la tomará mientras tanto.</p>}
              <div className="grid gap-2 border-t border-slate-800 pt-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <div className="space-y-2">
                  <Label htmlFor="task-project">Mover chat a otro proyecto del tablero</Label>
                  <Select value={projectTarget} onValueChange={setProjectTarget} disabled={Boolean(savingAction)}>
                    <SelectTrigger id="task-project" className="w-full border-slate-700 bg-slate-900"><SelectValue /></SelectTrigger>
                    <SelectContent>{projectOptions.map((project) => <SelectItem key={project.name} value={project.name}>{project.name} ({project.count})</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <Button variant="outline" disabled={Boolean(savingAction) || projectTarget === task.projectName} onClick={() => onAction("MOVE_PROJECT", undefined, undefined, projectTarget)}><MoveRight className="mr-2 h-4 w-4" /> Cambiar proyecto</Button>
              </div>
              <div className="flex flex-wrap gap-2 border-t border-slate-800 pt-3">
                {canClose && <Button className="bg-emerald-600 text-white hover:bg-emerald-500" disabled={Boolean(savingAction)} onClick={() => setConfirmation("CLOSE")}><CheckCircle2 className="mr-2 h-4 w-4" /> Cerrar como realizada</Button>}
                {task.lifecycle !== "ARCHIVED" && <Button variant="outline" disabled={Boolean(savingAction)} onClick={() => setConfirmation("ARCHIVE")}><Archive className="mr-2 h-4 w-4" /> Archivar</Button>}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3 text-xs text-slate-400">
            Archivar, cerrar y cambiar de proyecto sólo organizan este tablero. Las interrupciones recientes se reanudan por política; mover o reabrir una tarea antigua en “Para el agente” autoriza una nueva ejecución.
          </div>
          {savingAction && <p role="status" className="text-center text-sm text-cyan-200"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Guardando; esperá para cerrar.</p>}
          <DialogFooter className="sticky bottom-0 -mx-6 -mb-6 border-t border-slate-800 bg-slate-950 px-6 py-4">
            <Button className="min-h-11" variant="ghost" disabled={Boolean(savingAction)} onClick={() => onOpenChange(false)}>Cerrar ficha</Button>
            {savingAction
              ? <Button className="min-h-11" variant="outline" disabled><ExternalLink className="mr-2 h-4 w-4" /> Abrir en Codex</Button>
              : <Button className="min-h-11" asChild variant="outline"><a href={task.codexUrl}><ExternalLink className="mr-2 h-4 w-4" /> Abrir en Codex</a></Button>}
          </DialogFooter>
        </>}
      </DialogContent>
    </Dialog>
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
  const [activeSection, setActiveSection] = useState<SectionId | null>(null);
  const [navigationRequest, setNavigationRequest] = useState(0);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [moveTarget, setMoveTarget] = useState("PENDING");
  const [projectTarget, setProjectTarget] = useState("");
  const [savingAction, setSavingAction] = useState<ManagementAction | null>(null);
  const [confirmation, setConfirmation] = useState<"ARCHIVE" | "CLOSE" | "AUTO_RESUME" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(URL, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const freshSnapshot = await response.json() as Snapshot;
      setSnapshot(freshSnapshot);
      setError(null);
      return freshSnapshot;
    } catch {
      setError("No pude leer el inventario de tareas. El diagnóstico técnico sigue disponible abajo.");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const openTask = useCallback((task: Task) => {
    setSelectedTask(task);
    setMoveTarget(moveTargetForTask(task));
    setProjectTarget(task.projectName);
    setConfirmation(null);
    setActionError(null);
    setActionNotice(null);
  }, []);

  const manageTask = useCallback(async (action: ManagementAction, targetStatus?: string, confirmed?: boolean, targetProjectName?: string) => {
    if (!selectedTask || savingAction) return;
    setSavingAction(action);
    setActionError(null);
    setActionNotice(null);
    try {
      const response = await fetch(URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          threadId: selectedTask.threadId,
          targetStatus,
          targetProjectName,
          confirmed,
          expectedFingerprint: selectedTask.fingerprint,
          expectedVersion: selectedTask.boardVersion,
          idempotencyKey: `${["MOVE", "REOPEN"].includes(action) && targetStatus === "PENDING" ? "dashboard:auto-resume" : "dashboard"}:${window.crypto.randomUUID()}`,
        }),
      });
      const payload = await response.json().catch(() => null) as null | { error?: string; task?: Task };
      if (!response.ok) {
        let recoveredConflict = false;
        if (response.status === 409) {
          const freshSnapshot = await refresh();
          const freshTask = freshSnapshot ? findSnapshotTask(freshSnapshot, selectedTask.threadId) : null;
          if (freshTask) {
            setSelectedTask(freshTask);
            setProjectTarget(freshTask.projectName);
            setMoveTarget(moveTargetForTask(freshTask));
            setConfirmation(null);
            recoveredConflict = true;
          }
        }
        const baseMessage = payload?.error || `No se pudo guardar (HTTP ${response.status})`;
        throw new Error(recoveredConflict ? `${baseMessage} La ficha ya fue actualizada; revisala y volvé a guardar.` : baseMessage);
      }
      if (payload?.task) {
        setSelectedTask(payload.task);
        setProjectTarget(payload.task.projectName);
        setMoveTarget(moveTargetForTask(payload.task));
      }
      setActionNotice(action === "MOVE" && targetStatus === "PENDING" ? "La tarea quedó autorizada para reanudarse automáticamente." : action === "MOVE" ? "La tarea se movió de lista." : action === "MOVE_PROJECT" && selectedTask.autoResumeApproved ? "El chat se movió de proyecto y la autorización automática quedó revocada; vuelve a Sin revisar." : action === "MOVE_PROJECT" ? "El chat se movió de proyecto en el tablero." : action === "ARCHIVE" ? "La tarea quedó archivada." : action === "CLOSE" ? "La tarea quedó cerrada como realizada." : action === "REOPEN" && targetStatus === "PENDING" ? "La tarea quedó reabierta y autorizada para reanudarse automáticamente." : "La tarea quedó abierta nuevamente.");
      setConfirmation(null);
      await refresh();
    } catch (managementError) {
      setActionError(managementError instanceof Error ? managementError.message : "No pude guardar el cambio. Actualizá la ficha e intentá nuevamente.");
    } finally {
      setSavingAction(null);
    }
  }, [refresh, savingAction, selectedTask]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    if (!selectedTask || !snapshot) return;
    const freshTask = findSnapshotTask(snapshot, selectedTask.threadId);
    if (freshTask && freshTask !== selectedTask) setSelectedTask(freshTask);
  }, [selectedTask, snapshot]);

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
    { section: "unreviewed" as const, label: "Sin revisar", value: snapshot?.summary.unreviewed ?? 0, className: "text-slate-400" },
    { section: "pending" as const, label: "Cola automática", value: snapshot?.summary.pending ?? 0, className: "text-slate-100" },
    { section: "needsDiego" as const, label: "Necesito de vos", value: snapshot?.summary.needsDiego ?? 0, className: "text-amber-300" },
    { section: "blocked" as const, label: "Con problemas", value: snapshot?.summary.blocked ?? 0, className: "text-rose-300" },
    { section: "readyReview" as const, label: "Terminó sin cierre", value: snapshot?.summary.readyReview ?? 0, className: "text-violet-300" },
    { section: "done" as const, label: "Terminadas", value: snapshot?.summary.done ?? 0, className: "text-emerald-300" },
    { section: "archived" as const, label: "Archivadas", value: snapshot?.summary.archived ?? 0, className: "text-slate-400" },
    { section: "monitoring" as const, label: "Monitoreos activos", value: snapshot?.monitoring.length ?? 0, className: "text-cyan-200" },
    { section: "commercial" as const, label: "Ideas y ofertas", value: snapshot ? Math.max(snapshot.commercialIdeas.length, snapshot.commercialNextAction ? 1 : 0) : 0, className: "text-emerald-200" },
  ], [snapshot]);

  const activePanel = (() => {
    switch (activeSection) {
      case "now": return <TaskSection title="Trabajando ahora" description="Tareas que tienen una ejecución activa." tasks={snapshot?.now ?? []} empty="No hay una tarea activa en este momento." accent="border-cyan-500/25" onOpenTask={openTask} />;
      case "unreviewed": return <TaskSection title="Sin revisar" description="Tareas antiguas que quedaron fuera de la ventana autónoma; no generan pedidos ni avisos." tasks={snapshot?.unreviewed ?? []} empty="No hay tareas pendientes de clasificación." accent="border-slate-700" onOpenTask={openTask} />;
      case "needsDiego": return <TaskSection title="Necesito que decidas" description="Decisiones, permisos o datos que sólo vos podés dar." tasks={snapshot?.needsDiego ?? []} empty="No hay decisiones tuyas pendientes." accent="border-amber-500/25" onOpenTask={openTask} />;
      case "pending": return <TaskSection title="Cola automática" description="El agente toma una por vez: incluye interrupciones recientes y tareas antiguas que autorizaste manualmente." tasks={snapshot?.pending ?? []} empty="No hay tareas para reanudar." onOpenTask={openTask} />;
      case "blocked": return <TaskSection title="Con problemas" description="Bloqueos por accesos, dependencias externas, errores o tiempo agotado." tasks={snapshot?.blocked ?? []} empty="No hay bloqueos detectados." accent="border-rose-500/25" onOpenTask={openTask} />;
      case "readyReview": return <TaskSection title="Terminó sin cierre automático" description="Son ejecuciones sin el marcador y readback suficientes; no se consideran terminadas." tasks={snapshot?.readyReview ?? []} empty="No hay resultados sin cierre automático." accent="border-violet-500/25" onOpenTask={openTask} />;
      case "monitoring": return <TaskSection title="Monitoreos activos" description="Controles recurrentes que el agente mantiene bajo observación." tasks={snapshot?.monitoring ?? []} empty="No hay monitoreos activos." accent="border-cyan-500/20" onOpenTask={openTask} />;
      case "commercial": return <CommercialSection snapshot={snapshot} />;
      case "done": return <TaskSection title="Terminadas" description="Resultado verificado por marcador estructurado, cambio durable y readback posterior." tasks={snapshot?.done ?? []} empty="Todavía no hay tareas terminadas con verificación." accent="border-emerald-500/25" onOpenTask={openTask} />;
      case "archived": return <TaskSection title="Archivadas" description="Tareas fuera de las listas activas, con su historial preservado." tasks={snapshot?.archived ?? []} empty="No hay tareas archivadas." accent="border-slate-700" onOpenTask={openTask} />;
      default: return null;
    }
  })();

  if (loading && !snapshot) return <div className="flex min-h-64 items-center justify-center text-slate-400"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Leyendo tareas de Codex…</div>;

  return (
    <div className="space-y-6">
      <TaskManagerDialog
        task={selectedTask}
        projects={snapshot?.projects ?? []}
        moveTarget={moveTarget}
        setMoveTarget={setMoveTarget}
        projectTarget={projectTarget}
        setProjectTarget={setProjectTarget}
        savingAction={savingAction}
        confirmation={confirmation}
        setConfirmation={setConfirmation}
        error={actionError}
        notice={actionNotice}
        autoResumeReady={Boolean(snapshot?.activity?.fresh && snapshot.activity.autoResumeEnabled)}
        onOpenChange={(open) => {
          if (!open && !savingAction) {
            setSelectedTask(null);
            setConfirmation(null);
            setActionError(null);
            setActionNotice(null);
          }
        }}
        onAction={(action, targetStatus, confirmed, targetProjectName) => void manageTask(action, targetStatus, confirmed, targetProjectName)}
      />
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
            <Badge className={snapshot?.activity?.fresh && snapshot.activity.autoResumeEnabled ? "bg-cyan-500/15 text-cyan-200" : "bg-slate-800 text-slate-400"}>
              {snapshot?.activity?.fresh && snapshot.activity.autoResumeEnabled ? "AUTÓNOMO ACTIVO" : "SÓLO INVENTARIO"}
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
        <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4 text-sm text-slate-400"><CheckCircle2 className="mb-2 h-5 w-5 text-emerald-300" />“Terminada” exige evidencia, marcador estructurado y readback; no aprobación rutinaria.</div>
      </section>
    </div>
  );
}
