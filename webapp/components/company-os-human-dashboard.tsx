"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Archive,
  BadgeDollarSign,
  Bot,
  CheckCircle2,
  CircleHelp,
  ClipboardCopy,
  Clock3,
  ExternalLink,
  Loader2,
  MoveRight,
  RefreshCw,
  RotateCcw,
  Save,
  Sparkles,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

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
  blockerReason: string | null;
  decisionRequest: string | null;
  resultSummary: string | null;
  resultObservedAt: string | null;
  taskSummary: string;
  humanResponse: string | null;
  humanResponseRevision: number | null;
  humanResponseUpdatedAt: string | null;
  humanResponseProgress: string | null;
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
  lastObservedAt: string;
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
type ManagementAction = "MOVE" | "MOVE_PROJECT" | "SAVE" | "ARCHIVE" | "CLOSE" | "REOPEN";
type SavingAction = ManagementAction | "SUBMIT_REPLY";

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

function replyDraftForTask(task: Task) {
  return task.humanResponseProgress === "NEEDS_FOLLOWUP" ? "" : task.humanResponse ?? "";
}

function humanAttentionState(task: Task, includeQueuedReply = false) {
  const queuedReplyIsEditable = includeQueuedReply && task.humanResponseProgress === "CONFIRMED";
  if (!["NEEDS_DIEGO", "BLOCKED"].includes(task.humanStatus) && !queuedReplyIsEditable) return { blocker: null, request: null, canAnswerHere: false };
  const blocker = task.blockerReason ?? task.attentionReason;
  const request = task.decisionRequest ?? (task.humanStatus === "NEEDS_DIEGO" || queuedReplyIsEditable
    ? "Respondé “Autorizo continuar” o “No autorizo”. Si el paso requiere una credencial o código, completalo en el servicio correspondiente y confirmá sólo “Paso seguro completado”; no pegues el dato."
    : null);
  return { blocker, request, canAnswerHere: task.humanStatus === "NEEDS_DIEGO" || queuedReplyIsEditable };
}

const INCOMPLETE_DIAGNOSES = new Set([
  "La tarea depende de un acceso, proveedor o evento externo.",
  "La tarea depende de un tercero o servicio externo.",
  "La tarea quedó bloqueada y necesita revisión antes de continuar.",
  "No pude identificar una causa concreta sin exponer información protegida.",
]);

export function diagnosisIsIncomplete(reason: string | null) {
  return !reason || INCOMPLETE_DIAGNOSES.has(reason.trim());
}

function resolutionGuidanceForTask(task: Task) {
  const reason = task.blockerReason ?? task.attentionReason;
  if (diagnosisIsIncomplete(reason) && !task.decisionRequest) {
    return {
      quality: "INCOMPLETE" as const,
      owner: "Agente A0",
      destination: "Diagnóstico técnico",
      instruction: "Revisá esta tarea y devolvé una causa raíz concreta, quién puede resolverla y el único próximo paso verificable. No continúes con cambios sensibles ni expongas secretos.",
      help: "Todavía no hay datos suficientes para derivarla bien. Primero pedile al agente que precise el diagnóstico.",
    };
  }
  if (task.humanStatus === "NEEDS_DIEGO" || /\b(?:otp|captcha|c[oó]digo|credencial|contrase[nñ]a|acceso|iniciar sesi[oó]n|acci[oó]n f[ií]sica)\b/i.test(reason ?? "")) {
    return {
      quality: "SPECIFIC" as const,
      owner: "Diego",
      destination: "Necesito de vos",
      instruction: task.decisionRequest ?? "Completá el paso seguro fuera del tablero y confirmá acá solamente que quedó hecho.",
      help: "Este destrabe requiere una decisión o acción humana. No compartas el dato sensible en la ficha.",
    };
  }
  if (/\b(?:proveedor|tercero|servicio externo|esperando|dependencia externa|evento externo)\b/i.test(reason ?? "")) {
    return {
      quality: "SPECIFIC" as const,
      owner: "Proveedor o servicio externo",
      destination: "Con problemas",
      instruction: "Confirmá con el tercero si la dependencia cambió. Cuando esté resuelta, actualizá el estado y guardá para que el agente retome.",
      help: "Codex no puede resolver esta dependencia por sí solo; la ficha debe conservarse hasta recibir confirmación externa.",
    };
  }
  return {
    quality: "SPECIFIC" as const,
    owner: "Agente A0",
    destination: "Para el agente",
    instruction: task.nextAction,
    help: "El problema parece técnico y puede volver al agente una vez retirada la causa indicada.",
  };
}

const REPLY_PROGRESS: Record<string, { title: string; detail: string; className: string }> = {
  CONFIRMED: { title: "Respuesta guardada · En cola", detail: "Está confirmada y esperando que el agente la tome una sola vez.", className: "border-emerald-500/25 bg-emerald-500/10 text-emerald-100" },
  IN_PROGRESS: { title: "Codex está trabajando con tu respuesta", detail: "La tarea fue tomada; el tablero espera el resultado verificable.", className: "border-cyan-500/30 bg-cyan-500/10 text-cyan-100" },
  READY_REVIEW: { title: "La tarea salió del bloqueo", detail: "Codex avanzó y el resultado verificado aparece en esta ficha.", className: "border-violet-500/30 bg-violet-500/10 text-violet-100" },
  NEEDS_FOLLOWUP: { title: "Codex avanzó y necesita otra decisión", detail: "La tarea cambió y apareció un pedido nuevo. Respondelo acá; el tablero no reenviará la respuesta anterior.", className: "border-amber-500/30 bg-amber-500/10 text-amber-100" },
  DELIVERED: { title: "Codex recibió la respuesta y terminó", detail: "El tablero verificó la ejecución y muestra abajo el resultado obtenido.", className: "border-cyan-500/25 bg-cyan-500/10 text-cyan-100" },
  UNKNOWN_OUTCOME: { title: "Resultado todavía no confirmado", detail: "El tablero la mantiene bloqueada y no reenvía la respuesta para evitar duplicados. Podés gestionar el próximo intento acá.", className: "border-rose-500/30 bg-rose-500/10 text-rose-100" },
  FAILED: { title: "La respuesta no pudo entregarse", detail: "Revisá el estado de la tarea antes de volver a guardarla.", className: "border-rose-500/30 bg-rose-500/10 text-rose-100" },
  SUPERSEDED: { title: "La tarea cambió antes del envío", detail: "La respuesta quedó en el historial, pero no se enviará. Revisá el pedido actualizado antes de responder de nuevo.", className: "border-amber-500/30 bg-amber-500/10 text-amber-100" },
};

function TaskCard({ task, accent = "border-slate-800", onOpen }: {
  task: Task; accent?: string; onOpen: (task: Task) => void;
}) {
  const attention = humanAttentionState(task);
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
        {attention.blocker && <p className="mt-3 text-sm text-amber-100"><span className="font-semibold">Motivo:</span> {attention.blocker}</p>}
        {attention.request && <p className="mt-2 text-sm text-amber-200"><span className="font-semibold">Necesito de vos:</span> {attention.request}</p>}
        {task.humanStatus === "NEEDS_DIEGO" && <p className="mt-2 text-xs text-amber-100/60">Pedido observado {relativeTime(task.lastObservedAt)}</p>}
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
  replyDraft,
  setReplyDraft,
  savingAction,
  confirmation,
  setConfirmation,
  error,
  notice,
  autoResumeReady,
  onOpenChange,
  onAction,
  onSubmitReply,
}: {
  task: Task | null;
  projects: Array<{ name: string; count: number }>;
  moveTarget: string;
  setMoveTarget: (value: string) => void;
  projectTarget: string;
  setProjectTarget: (value: string) => void;
  replyDraft: string;
  setReplyDraft: (value: string) => void;
  savingAction: SavingAction | null;
  confirmation: "ARCHIVE" | "CLOSE" | "AUTO_RESUME" | null;
  setConfirmation: (action: "ARCHIVE" | "CLOSE" | "AUTO_RESUME" | null) => void;
  error: string | null;
  notice: string | null;
  autoResumeReady: boolean;
  onOpenChange: (open: boolean) => void;
  onAction: (action: ManagementAction, targetStatus?: string, confirmed?: boolean, targetProjectName?: string) => void;
  onSubmitReply: () => void;
}) {
  const [copyState, setCopyState] = useState<{ threadId: string; status: "COPIED" | "FAILED" } | null>(null);
  const isOpen = task?.lifecycle === "OPEN";
  const canClose = isOpen && task?.humanStatus === "READY_REVIEW";
  const canReopen = Boolean(task && (!isOpen || ["DONE", "DISCARDED"].includes(task.humanStatus)));
  const canAuthorizeAutoResume = Boolean(task && !task.sourceArchived && !task.attentionReason && ["IDLE", "NOT_LOADED"].includes(task.sourceStatus) && !task.autoResumeRunning);
  const needsHumanDecision = task?.humanStatus === "NEEDS_DIEGO";
  const queuedReplyIsEditable = task?.humanResponseProgress === "CONFIRMED";
  const attention = task ? humanAttentionState(task, true) : { blocker: null, request: null, canAnswerHere: false };
  const replyProgress = task?.humanResponseProgress ? REPLY_PROGRESS[task.humanResponseProgress] : null;
  const options = canReopen ? WORKFLOW_OPTIONS.filter((option) => ["PENDING", "NEEDS_DIEGO"].includes(option.value)) : WORKFLOW_OPTIONS;
  const projectOptions = task && !projects.some((project) => project.name === task.projectName)
    ? [{ name: task.projectName, count: 0 }, ...projects]
    : projects;
  const guidance = task ? resolutionGuidanceForTask(task) : null;
  const currentCopyState = copyState && copyState.threadId === task?.threadId ? copyState.status : "IDLE";
  const organizationDirty = Boolean(task && (moveTarget !== moveTargetForTask(task) || projectTarget !== task.projectName));

  const saveOrganization = () => {
    if (!task || !organizationDirty) return;
    if (moveTarget === "PENDING") {
      setConfirmation("AUTO_RESUME");
      return;
    }
    onAction("SAVE", moveTarget, false, projectTarget);
  };

  const copyDiagnosisInstruction = async () => {
    if (!guidance) return;
    try {
      await navigator.clipboard.writeText(guidance.instruction);
      setCopyState({ threadId: task?.threadId ?? "", status: "COPIED" });
    } catch {
      setCopyState({ threadId: task?.threadId ?? "", status: "FAILED" });
    }
  };

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

          <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Resumen de la tarea</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-100">{task.taskSummary}</p>
          </div>

          {(attention.blocker || attention.request) && (
            <div className="rounded-xl border border-amber-400/40 bg-amber-500/10 p-4 text-amber-50">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-300">Motivo del bloqueo</p>
              <p className="mt-2 text-sm leading-relaxed whitespace-pre-line">{attention.blocker ?? "Codex necesita una intervención antes de continuar."}</p>
              {attention.request && <><p className="mt-4 text-xs font-bold uppercase tracking-[0.16em] text-amber-300">Qué necesito de vos</p><p className="mt-2 text-base font-semibold leading-relaxed whitespace-pre-line">{attention.request}</p></>}
              {needsHumanDecision && <p className="mt-2 text-xs text-amber-100/60">Pedido confirmado por el último escaneo {relativeTime(task.lastObservedAt)}.</p>}
              {(needsHumanDecision || queuedReplyIsEditable) && (
                <div className="mt-4 space-y-3 border-t border-amber-400/20 pt-4">
                  <div className="grid gap-2 text-sm sm:grid-cols-2">
                    <p><span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-400/15 font-bold text-amber-200">1</span>{queuedReplyIsEditable ? "La respuesta sigue en cola: todavía podés modificarla." : "Escribí abajo la autorización o decisión concreta."}</p>
                    <p><span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-400/15 font-bold text-amber-200">2</span>{queuedReplyIsEditable ? "Al guardar, la nueva versión reemplaza sólo la entrega pendiente." : "Guardarla pone la tarea en cola para que Codex continúe."}</p>
                  </div>
                  {attention.canAnswerHere && (
                    <div className="space-y-2">
                      <Label htmlFor="task-human-response" className="text-amber-50">Tu autorización o decisión</Label>
                      <Textarea
                        id="task-human-response"
                        value={replyDraft}
                        onChange={(event) => setReplyDraft(event.target.value)}
                        maxLength={1000}
                        rows={4}
                        disabled={Boolean(savingAction) || task.autoResumeRunning || task.humanResponseProgress === "IN_PROGRESS"}
                        aria-describedby="task-human-response-help"
                        placeholder="Ejemplo: Elegí la opción B. Avanzá con un precio de USD 350 y dejalo listo para que yo lo revise."
                        className="border-amber-400/30 bg-slate-950 text-slate-100 placeholder:text-slate-600"
                      />
                      <div id="task-human-response-help" className="flex flex-wrap justify-between gap-2 text-xs text-amber-100/70">
                        <span>No pegues contraseñas, tokens, códigos, correos, teléfonos, enlaces ni rutas.</span>
                        <span>{replyDraft.length}/1000</span>
                      </div>
                      <Button
                        className="min-h-11 bg-amber-400 text-slate-950 hover:bg-amber-300"
                        disabled={Boolean(savingAction) || replyDraft.trim().length < 2 || task.autoResumeRunning || task.humanResponseProgress === "IN_PROGRESS"}
                        onClick={onSubmitReply}
                      >
                        {savingAction === "SUBMIT_REPLY" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Bot className="mr-2 h-4 w-4" />}
                        {task.humanResponseProgress === "NEEDS_FOLLOWUP" ? "Guardar nueva respuesta y continuar" : task.humanResponse ? "Guardar modificación y continuar" : "Guardar autorización y continuar"}
                      </Button>
                      <p className="text-xs text-amber-100/70">No tenés que volver a Codex: esta ficha mostrará Respuesta guardada → En cola → Codex trabajando → Resultado.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {guidance && ["NEEDS_DIEGO", "BLOCKED"].includes(task.humanStatus) && (
            <div className={`rounded-xl border p-4 ${guidance.quality === "INCOMPLETE" ? "border-rose-400/35 bg-rose-500/10" : "border-cyan-400/25 bg-cyan-500/5"}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className={`text-xs font-bold uppercase tracking-[0.16em] ${guidance.quality === "INCOMPLETE" ? "text-rose-300" : "text-cyan-300"}`}>{guidance.quality === "INCOMPLETE" ? "Diagnóstico incompleto" : "Derivación recomendada"}</p>
                  <p className="mt-2 text-base font-semibold text-slate-100">Responsable: {guidance.owner}</p>
                  <p className="mt-1 text-sm text-slate-300">Destino sugerido: {guidance.destination}</p>
                </div>
                <Badge variant="outline" className={guidance.quality === "INCOMPLETE" ? "border-rose-400/40 text-rose-200" : "border-cyan-400/40 text-cyan-200"}>{guidance.quality === "INCOMPLETE" ? "Falta causa exacta" : "Causa identificada"}</Badge>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-slate-200">{guidance.help}</p>
              <div className="mt-3 rounded-lg border border-slate-700 bg-slate-950/70 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Qué hacer ahora</p>
                <p className="mt-2 text-sm leading-relaxed text-slate-100">{guidance.instruction}</p>
              </div>
              {guidance.quality === "INCOMPLETE" && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" disabled={Boolean(savingAction)} onClick={copyDiagnosisInstruction}><ClipboardCopy className="mr-2 h-4 w-4" /> Copiar instrucción para Codex</Button>
                  <span role="status" className="text-xs text-slate-400">{currentCopyState === "COPIED" ? "Instrucción copiada." : currentCopyState === "FAILED" ? "No se pudo copiar; seleccioná el texto de arriba." : "Pegala en el historial técnico de esta tarea."}</span>
                </div>
              )}
            </div>
          )}
          {replyProgress && <div role="status" aria-live="polite" className={`rounded-xl border p-3 text-sm ${replyProgress.className}`}><span className="font-semibold">{replyProgress.title}.</span> {replyProgress.detail}{task.humanResponseUpdatedAt ? ` Último cambio ${relativeTime(task.humanResponseUpdatedAt)}.` : ""}</div>}
          {(task.resultSummary || task.humanStatus === "READY_REVIEW") && (
            <div className="rounded-xl border border-violet-500/30 bg-violet-500/10 p-4 text-violet-50">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-violet-300">Resultado de Codex</p>
              <p className="mt-2 text-sm leading-relaxed">{task.resultSummary ?? "Codex terminó, pero el resumen todavía no quedó confirmado. La tarea seguirá visible para revisión."}</p>
              {task.resultObservedAt && <p className="mt-2 text-xs text-violet-200/60">Resultado observado {relativeTime(task.resultObservedAt)}.</p>}
            </div>
          )}
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
              <span className="font-semibold">Codex está ejecutando esta tarea.</span>{task.boardUpdatedAt ? ` La tomó ${relativeTime(task.boardUpdatedAt)}.` : ""} Para no confundir el estado ni perder el readback, mover, archivar y cerrar quedan bloqueados hasta que termine o venza el límite de seguridad.
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
                  onClick={() => confirmation === "AUTO_RESUME" ? onAction("SAVE", "PENDING", true, projectTarget) : onAction(confirmation, undefined, confirmation === "CLOSE")}
                >
                  {savingAction ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : confirmation === "CLOSE" ? <CheckCircle2 className="mr-2 h-4 w-4" /> : confirmation === "AUTO_RESUME" ? <Bot className="mr-2 h-4 w-4" /> : <Archive className="mr-2 h-4 w-4" />}
                  {confirmation === "AUTO_RESUME" ? "Sí, autorizar y reanudar" : confirmation === "CLOSE" ? "Sí, cerrar como realizada" : "Sí, archivar"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3 rounded-xl border border-slate-800 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><p className="font-semibold text-slate-100">Organización y derivación</p><p className="mt-1 text-xs text-slate-500">Elegí estado y proyecto; ambos se guardan juntos.</p></div>
                <Badge variant="outline" className={organizationDirty ? "border-amber-400/40 text-amber-200" : "border-emerald-400/30 text-emerald-300"}>{organizationDirty ? "Cambios sin guardar" : "Todo guardado"}</Badge>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="task-destination">{canReopen ? "Reabrir en" : "Estado de resolución"}</Label>
                  <Select value={moveTarget} onValueChange={setMoveTarget} disabled={Boolean(savingAction)}>
                    <SelectTrigger id="task-destination" className="w-full border-slate-700 bg-slate-900"><SelectValue /></SelectTrigger>
                    <SelectContent>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="task-project">Proyecto responsable</Label>
                  <Select value={projectTarget} onValueChange={setProjectTarget} disabled={Boolean(savingAction)}>
                    <SelectTrigger id="task-project" className="w-full border-slate-700 bg-slate-900"><SelectValue /></SelectTrigger>
                    <SelectContent>{projectOptions.map((project) => <SelectItem key={project.name} value={project.name}>{project.name} ({project.count})</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-xs text-slate-500">Las tareas recientes interrumpidas entran solas. Guardar “Para el agente” autoriza una nueva ejecución. “Trabajando ahora” aparece cuando Codex la toma.</p>
              {moveTarget === "PENDING" && !canAuthorizeAutoResume && <p className="text-xs text-amber-300">Primero resolvé la decisión o ejecución activa indicada arriba; el reanudador no la tomará mientras tanto.</p>}
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
            <Button className="min-h-11" variant="ghost" disabled={Boolean(savingAction)} onClick={() => onOpenChange(false)}>{organizationDirty ? "Cerrar sin guardar" : "Cerrar ficha"}</Button>
            <Button className="min-h-11 bg-cyan-600 text-white hover:bg-cyan-500" disabled={Boolean(savingAction) || !organizationDirty || (moveTarget === "PENDING" && !canAuthorizeAutoResume)} onClick={saveOrganization}>
              {savingAction === "SAVE" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : canReopen ? <RotateCcw className="mr-2 h-4 w-4" /> : <Save className="mr-2 h-4 w-4" />}
              {moveTarget === "PENDING" ? "Guardar y reanudar" : "Guardar cambios"}
            </Button>
            {savingAction
              ? <Button className="min-h-11" variant="outline" disabled><ExternalLink className="mr-2 h-4 w-4" /> Ver historial técnico en Codex</Button>
              : <Button className="min-h-11" asChild variant="outline"><a href={task.codexUrl}><ExternalLink className="mr-2 h-4 w-4" /> Ver historial técnico en Codex</a></Button>}
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
  const [replyDraft, setReplyDraft] = useState("");
  const [replyDirty, setReplyDirty] = useState(false);
  const [savingAction, setSavingAction] = useState<SavingAction | null>(null);
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
    setReplyDraft(replyDraftForTask(task));
    setReplyDirty(false);
    setConfirmation(null);
    setActionError(null);
    setActionNotice(null);
  }, []);

  const updateReplyDraft = useCallback((value: string) => {
    setReplyDraft(value);
    setReplyDirty(true);
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
          idempotencyKey: `${["MOVE", "REOPEN", "SAVE"].includes(action) && targetStatus === "PENDING" ? "dashboard:auto-resume" : "dashboard"}:${window.crypto.randomUUID()}`,
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
      setActionNotice(action === "SAVE" && targetStatus === "PENDING" ? "Estado y proyecto guardados; la tarea quedó autorizada para reanudarse automáticamente." : action === "SAVE" ? "Estado y proyecto quedaron guardados juntos." : action === "MOVE" && targetStatus === "PENDING" ? "La tarea quedó autorizada para reanudarse automáticamente." : action === "MOVE" ? "La tarea se movió de lista." : action === "MOVE_PROJECT" && selectedTask.autoResumeApproved ? "El chat se movió de proyecto y la autorización automática quedó revocada; vuelve a Sin revisar." : action === "MOVE_PROJECT" ? "El chat se movió de proyecto en el tablero." : action === "ARCHIVE" ? "La tarea quedó archivada." : action === "CLOSE" ? "La tarea quedó cerrada como realizada." : action === "REOPEN" && targetStatus === "PENDING" ? "La tarea quedó reabierta y autorizada para reanudarse automáticamente." : "La tarea quedó abierta nuevamente.");
      setConfirmation(null);
      await refresh();
    } catch (managementError) {
      setActionError(managementError instanceof Error ? managementError.message : "No pude guardar el cambio. Actualizá la ficha e intentá nuevamente.");
    } finally {
      setSavingAction(null);
    }
  }, [refresh, savingAction, selectedTask]);

  const submitReply = useCallback(async () => {
    if (!selectedTask || savingAction || replyDraft.trim().length < 2) return;
    setSavingAction("SUBMIT_REPLY");
    setActionError(null);
    setActionNotice(null);
    try {
      const response = await fetch(URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "SUBMIT_REPLY",
          threadId: selectedTask.threadId,
          responseText: replyDraft,
          confirmed: true,
          expectedFingerprint: selectedTask.fingerprint,
          expectedVersion: selectedTask.boardVersion,
          idempotencyKey: `dashboard:human-reply:${window.crypto.randomUUID()}`,
        }),
      });
      const payload = await response.json().catch(() => null) as null | { error?: string; task?: Task };
      if (!response.ok) {
        if (response.status === 409) {
          const freshSnapshot = await refresh();
          const freshTask = freshSnapshot ? findSnapshotTask(freshSnapshot, selectedTask.threadId) : null;
          if (freshTask) {
            setSelectedTask(freshTask);
            setReplyDraft(replyDraftForTask(freshTask));
            setReplyDirty(false);
          }
        }
        throw new Error(payload?.error || `No se pudo guardar la respuesta (HTTP ${response.status})`);
      }
      if (payload?.task) {
        setSelectedTask(payload.task);
        setReplyDraft(replyDraftForTask(payload.task));
      }
      setReplyDirty(false);
      setActionNotice(selectedTask.humanResponseProgress === "NEEDS_FOLLOWUP" ? "La nueva respuesta quedó guardada para el pedido actualizado." : selectedTask.humanResponse ? "La modificación quedó guardada y confirmada. Codex usará sólo esta última revisión." : "Tu respuesta quedó guardada y confirmada. Verás cuando Codex la tome.");
      await refresh();
    } catch (replyError) {
      setActionError(replyError instanceof Error ? replyError.message : "No pude guardar la respuesta. El texto sigue acá para que vuelvas a intentar.");
    } finally {
      setSavingAction(null);
    }
  }, [refresh, replyDraft, savingAction, selectedTask]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    if (!selectedTask || !snapshot) return;
    const freshTask = findSnapshotTask(snapshot, selectedTask.threadId);
    if (freshTask && freshTask !== selectedTask) {
      setSelectedTask(freshTask);
      if (!replyDirty) setReplyDraft(replyDraftForTask(freshTask));
    }
  }, [replyDirty, selectedTask, snapshot]);

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
        replyDraft={replyDraft}
        setReplyDraft={updateReplyDraft}
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
            setReplyDirty(false);
            setReplyDraft("");
          }
        }}
        onAction={(action, targetStatus, confirmed, targetProjectName) => void manageTask(action, targetStatus, confirmed, targetProjectName)}
        onSubmitReply={() => void submitReply()}
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
