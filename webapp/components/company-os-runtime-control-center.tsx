"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  CirclePause,
  CirclePlay,
  Clock3,
  CheckCircle2,
  CircleHelp,
  GitBranch,
  Loader2,
  MessagesSquare,
  RefreshCw,
  RotateCcw,
  ServerCog,
  Users,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const CONTROL_CENTER_URL = "/api/company-os/runtime/v1/control-center";
const RUNTIME_CONTROL_URL = "/api/company-os/runtime/v1/control";
const POLL_INTERVAL_MS = 15_000;

const workerStates = new Set([
  "UNKNOWN",
  "IDLE",
  "BUSY",
  "DRAINING",
  "STOPPED",
  "DEGRADED",
  "PAUSED",
  "STARTING",
]);
const installationStates = new Set([
  "UNKNOWN",
  "INSTALLED",
  "NOT_INSTALLED",
  "DISABLED",
]);

type RuntimeWorker = {
  workerId: string;
  host: string | null;
  version: string | null;
  state: string;
  startedAt: string | null;
  lastHeartbeatAt: string | null;
  currentWork: unknown;
};

type RuntimeAgent = {
  agentId: string;
  name: string;
  reportsToAgentId: string | null;
  installationStatus: string;
  status: string;
  currentCaseId: string | null;
};

type RuntimeSchedule = {
  id: string;
  agentId: string;
  scheduleKey: string;
  enabled: boolean | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
};

type RuntimeAgentModelUsage = {
  agentId: string;
  model: string;
  dailyTokens: number | null;
  dailyCostUsd: number | null;
  monthlyTokens: number | null;
  monthlyCostUsd: number | null;
  tokens: number | null;
  costUsd: number | null;
};

type RuntimeIncident = {
  id: string;
  type: string;
  severity: string;
  status: string;
  summary: string;
  createdAt: string | null;
  lastSeenAt: string | null;
};

type RuntimeWorkItem = {
  id: string;
  requestId: string;
  objective: string;
  agentId: string;
  triggerType: string;
  status: string;
  priority: number | null;
  attemptCount: number | null;
  maxAttempts: number | null;
  availableAt: string | null;
  nextAttemptAt: string | null;
  completedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  lease: null | {
    status: string;
    workerId: string | null;
    slotNo: number | null;
    renewedAt: string | null;
    expiresAt: string | null;
  };
};

type RuntimeDependency = {
  key: string;
  status: string;
  observedAt: string | null;
  latencyMs: number | null;
};

type RuntimeMessage = {
  id: string;
  fromAgentId: string | null;
  toAgentId: string | null;
  messageType: string | null;
  status: string | null;
  summary: string | null;
  content: string | null;
  createdAt: string | null;
};

export type RuntimeControlCenterSnapshot = {
  generatedAt: string | null;
  runtime: {
    paused: boolean | null;
    globalConcurrency: number | null;
    updatedAt: string | null;
    overallHealth: string;
  };
  workers: RuntimeWorker[];
  agents: RuntimeAgent[];
  queue: {
    queued: number | null;
    claimed: number | null;
    running: number | null;
    needsReview: number | null;
    blocked: number | null;
    failedRetryable: number | null;
    failedFinal: number | null;
    oldestQueuedAt: string | null;
  };
  summary: {
    workingNow: number | null;
    inQueue: number | null;
    blocked: number | null;
    solvedToday: number | null;
    discoveredToday: number | null;
    approvals: number | null;
  };
  workItems: RuntimeWorkItem[];
  schedules: RuntimeSchedule[];
  usage: {
    dailyTokens: number | null;
    dailyCostUsd: number | null;
    monthlyTokens: number | null;
    monthlyCostUsd: number | null;
    byAgentModel: RuntimeAgentModelUsage[];
  };
  incidents: RuntimeIncident[];
  dependencies: RuntimeDependency[];
  messages: RuntimeMessage[];
};

type ControlAction = "PAUSE" | "RESUME" | "RETRY_CASE";
type ObservationState = "LOADING" | "OBSERVED" | "UNOBSERVED";

function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function records(value: unknown) {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function knownState(value: unknown, allowed: Set<string>, fallback: string) {
  const normalized = textValue(value)?.toUpperCase();
  return normalized && allowed.has(normalized) ? normalized : fallback;
}

function reportedState(value: unknown, fallback: string) {
  return textValue(value)?.toUpperCase() ?? fallback;
}

export function normalizeRuntimeControlCenterSnapshot(
  input: unknown,
): RuntimeControlCenterSnapshot {
  const source = asRecord(input);
  const runtime = asRecord(source.runtime);
  const queue = asRecord(source.queue);
  const usage = asRecord(source.usage);

  return {
    generatedAt: textValue(source.generatedAt),
    runtime: {
      paused:
        typeof runtime.paused === "boolean" ? runtime.paused : null,
      globalConcurrency: numberValue(runtime.globalConcurrency),
      updatedAt: textValue(runtime.updatedAt),
      overallHealth: reportedState(runtime.overallHealth, "UNOBSERVED"),
    },
    workers: records(source.workers).map((worker) => ({
      workerId: textValue(worker.workerId) ?? "UNOBSERVED",
      host: textValue(worker.host),
      version: textValue(worker.version),
      state: knownState(worker.state, workerStates, "UNKNOWN"),
      startedAt: textValue(worker.startedAt),
      lastHeartbeatAt: textValue(worker.lastHeartbeatAt),
      currentWork: Object.hasOwn(worker, "currentWork")
        ? worker.currentWork
        : undefined,
    })),
    agents: records(source.agents).map((agent) => ({
      agentId: textValue(agent.agentId) ?? "UNOBSERVED",
      name: textValue(agent.name) ?? textValue(agent.agentId) ?? "Agente sin identificar",
      reportsToAgentId: textValue(agent.reportsToAgentId),
      installationStatus: knownState(
        agent.installationStatus,
        installationStates,
        "UNKNOWN",
      ),
      status: reportedState(agent.status, "UNKNOWN"),
      currentCaseId: textValue(agent.currentCaseId),
    })),
    queue: {
      queued: numberValue(queue.queued),
      claimed: numberValue(queue.claimed),
      running: numberValue(queue.running),
      needsReview: numberValue(queue.needsReview),
      blocked: numberValue(queue.blocked),
      failedRetryable: numberValue(queue.failedRetryable),
      failedFinal: numberValue(queue.failedFinal),
      oldestQueuedAt: textValue(queue.oldestQueuedAt),
    },
    summary: {
      workingNow: numberValue(asRecord(source.summary).workingNow),
      inQueue: numberValue(asRecord(source.summary).inQueue),
      blocked: numberValue(asRecord(source.summary).blocked),
      solvedToday: numberValue(asRecord(source.summary).solvedToday),
      discoveredToday: numberValue(asRecord(source.summary).discoveredToday),
      approvals: numberValue(asRecord(source.summary).approvals),
    },
    workItems: records(source.workItems).map((workItem) => {
      const lease = asRecord(workItem.lease);
      const hasLease = Object.keys(lease).length > 0;
      return {
        id: textValue(workItem.id) ?? "UNOBSERVED",
        requestId: textValue(workItem.requestId) ?? "UNOBSERVED",
        objective: textValue(workItem.objective) ?? "Objetivo UNOBSERVED",
        agentId: textValue(workItem.agentId) ?? "UNOBSERVED",
        triggerType: textValue(workItem.triggerType) ?? "UNOBSERVED",
        status: reportedState(workItem.status, "UNKNOWN"),
        priority: numberValue(workItem.priority),
        attemptCount: numberValue(workItem.attemptCount),
        maxAttempts: numberValue(workItem.maxAttempts),
        availableAt: textValue(workItem.availableAt),
        nextAttemptAt: textValue(workItem.nextAttemptAt),
        completedAt: textValue(workItem.completedAt),
        createdAt: textValue(workItem.createdAt),
        updatedAt: textValue(workItem.updatedAt),
        lease: hasLease ? {
          status: reportedState(lease.status, "UNKNOWN"),
          workerId: textValue(lease.workerId),
          slotNo: numberValue(lease.slotNo),
          renewedAt: textValue(lease.renewedAt),
          expiresAt: textValue(lease.expiresAt),
        } : null,
      };
    }),
    schedules: records(source.schedules).map((schedule) => ({
      id: textValue(schedule.id) ?? "UNOBSERVED",
      agentId: textValue(schedule.agentId) ?? "UNOBSERVED",
      scheduleKey: textValue(schedule.scheduleKey) ?? "UNOBSERVED",
      enabled:
        typeof schedule.enabled === "boolean" ? schedule.enabled : null,
      nextRunAt: textValue(schedule.nextRunAt),
      lastRunAt: textValue(schedule.lastRunAt),
    })),
    usage: {
      dailyTokens: numberValue(usage.dailyTokens),
      dailyCostUsd: numberValue(usage.dailyCostUsd),
      monthlyTokens: numberValue(usage.monthlyTokens),
      monthlyCostUsd: numberValue(usage.monthlyCostUsd),
      byAgentModel: records(usage.byAgentModel).map((item) => ({
        agentId: textValue(item.agentId) ?? "UNOBSERVED",
        model: textValue(item.model) ?? "UNOBSERVED",
        dailyTokens: numberValue(item.dailyTokens),
        dailyCostUsd: numberValue(item.dailyCostUsd),
        monthlyTokens: numberValue(item.monthlyTokens),
        monthlyCostUsd: numberValue(item.monthlyCostUsd),
        tokens: numberValue(item.tokens),
        costUsd: numberValue(item.costUsd),
      })),
    },
    incidents: records(source.incidents).map((incident) => ({
      id: textValue(incident.id) ?? "UNOBSERVED",
      type: textValue(incident.type) ?? "UNKNOWN",
      severity: reportedState(incident.severity, "UNKNOWN"),
      status: reportedState(incident.status, "UNKNOWN"),
      summary: textValue(incident.summary) ?? "Sin resumen observado",
      createdAt: textValue(incident.createdAt),
      lastSeenAt: textValue(incident.lastSeenAt),
    })),
    dependencies: records(source.dependencies).map((dependency) => {
      const observedAt = textValue(dependency.observedAt);
      return {
        key: textValue(dependency.key) ?? "UNOBSERVED",
        status: observedAt
          ? reportedState(dependency.status, "UNKNOWN")
          : "UNOBSERVED",
        observedAt,
        latencyMs: numberValue(dependency.latencyMs),
      };
    }),
    messages: records(source.messages).map((message) => ({
      id: textValue(message.id) ?? "UNOBSERVED",
      fromAgentId: textValue(message.fromAgentId),
      toAgentId: textValue(message.toAgentId),
      messageType:
        textValue(message.messageType) ?? textValue(message.type),
      status:
        textValue(message.status)?.toUpperCase() ??
        textValue(message.deliveryStatus)?.toUpperCase() ??
        null,
      summary:
        textValue(message.summary) ??
        textValue(asRecord(message.payload).summary),
      content: textValue(message.content),
      createdAt: textValue(message.createdAt),
    })),
  };
}

export function flattenRuntimeAgentHierarchy(agents: RuntimeAgent[]) {
  const byParent = new Map<string | null, RuntimeAgent[]>();
  const ids = new Set(agents.map((agent) => agent.agentId));
  for (const agent of agents) {
    const parent =
      agent.reportsToAgentId && ids.has(agent.reportsToAgentId)
        ? agent.reportsToAgentId
        : null;
    byParent.set(parent, [...(byParent.get(parent) ?? []), agent]);
  }
  for (const children of byParent.values()) {
    children.sort((a, b) => a.name.localeCompare(b.name, "es"));
  }

  const rows: Array<{ agent: RuntimeAgent; depth: number }> = [];
  const visited = new Set<string>();
  function visit(agent: RuntimeAgent, depth: number) {
    if (visited.has(agent.agentId)) return;
    visited.add(agent.agentId);
    rows.push({ agent, depth });
    for (const child of byParent.get(agent.agentId) ?? []) {
      visit(child, depth + 1);
    }
  }
  for (const root of byParent.get(null) ?? []) visit(root, 0);
  for (const agent of agents) visit(agent, 0);
  return rows;
}

function formatTimestamp(value: string | null) {
  if (!value) return "UNOBSERVED";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("es-AR", { timeZone: "America/New_York" })
    : "UNOBSERVED";
}

function formatNumber(value: number | null) {
  return value == null ? "—" : value.toLocaleString("es-AR");
}

function formatCost(value: number | null) {
  return value == null ? "—" : `$${value.toFixed(4)}`;
}

export function deriveRuntimeFreshness(value: string | null, now = Date.now()) {
  if (!value) return "UNOBSERVED" as const;
  const observedAt = Date.parse(value);
  if (!Number.isFinite(observedAt)) return "UNOBSERVED" as const;
  const age = Math.max(0, now - observedAt);
  if (age <= 30_000) return "CURRENT" as const;
  if (age <= 150_000) return "STALE" as const;
  return "UNOBSERVED" as const;
}

function formatAge(value: string | null, now = Date.now()) {
  if (!value) return "UNOBSERVED";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "UNOBSERVED";
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1_000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function statusTone(status: string) {
  if (["IDLE", "HEALTHY", "CURRENT", "INSTALLED", "RESOLVED", "CLOSED", "COMPLETED"].includes(status))
    return "border-emerald-500/40 text-emerald-300";
  if (["BUSY", "RUNNING", "CLAIMED", "STARTING"].includes(status))
    return "border-violet-500/40 text-violet-300";
  if (["PAUSED", "DRAINING", "DEGRADED", "ATTENTION", "STALE", "NEEDS_REVIEW", "WARNING", "FAILED_RETRYABLE"].includes(status))
    return "border-amber-500/40 text-amber-300";
  if (["STOPPED", "FAILED", "FAILED_FINAL", "CRITICAL", "OPEN"].includes(status))
    return "border-red-500/40 text-red-300";
  return "border-slate-500/40 text-slate-300";
}

function currentWorkLabel(value: unknown): string {
  if (value === undefined) return "UNOBSERVED";
  if (value === null) return "Sin trabajo asignado";
  if (typeof value === "string") return value.slice(0, 180);
  if (Array.isArray(value)) {
    if (!value.length) return "Sin trabajo asignado";
    return value
      .slice(0, 3)
      .map((item) => currentWorkLabel(item))
      .join(" | ");
  }
  const work = asRecord(value);
  const parts = [
    textValue(work.requestId),
    textValue(work.caseId),
    textValue(work.agentId),
    textValue(work.attemptId),
    textValue(work.state),
  ].filter((item): item is string => Boolean(item));
  return parts.length ? parts.join(" · ") : "UNOBSERVED";
}

function queueMetrics(snapshot: RuntimeControlCenterSnapshot) {
  return [
    ["QUEUED", snapshot.queue.queued],
    ["CLAIMED", snapshot.queue.claimed],
    ["RUNNING", snapshot.queue.running],
    ["NEEDS_REVIEW", snapshot.queue.needsReview],
    ["BLOCKED", snapshot.queue.blocked],
    ["FAILED_RETRYABLE", snapshot.queue.failedRetryable],
    ["FAILED_FINAL", snapshot.queue.failedFinal],
  ] as const;
}

export function CompanyOsRuntimeControlCenter({ readOnly = false }: { readOnly?: boolean }) {
  const [snapshot, setSnapshot] = useState<RuntimeControlCenterSnapshot | null>(null);
  const [observation, setObservation] = useState<ObservationState>("LOADING");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [controlError, setControlError] = useState("");
  const [controlMessage, setControlMessage] = useState("");
  const [pendingAction, setPendingAction] = useState<ControlAction | null>(null);
  const [retryRequestId, setRetryRequestId] = useState("");
  const refreshSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    setRefreshing(true);
    try {
      const response = await fetch(CONTROL_CENTER_URL, {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = textValue(asRecord(payload).error);
        throw new Error(detail ?? "No se pudo observar el runtime");
      }
      if (sequence === refreshSequence.current) {
        setSnapshot(normalizeRuntimeControlCenterSnapshot(payload));
        setObservation("OBSERVED");
        setError("");
      }
    } catch (caught) {
      if (sequence === refreshSequence.current) {
        setObservation("UNOBSERVED");
        setError(
          caught instanceof Error
            ? caught.message
            : "No se pudo observar el runtime",
        );
      }
    } finally {
      if (sequence === refreshSequence.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const hierarchy = useMemo(
    () => flattenRuntimeAgentHierarchy(snapshot?.agents ?? []),
    [snapshot?.agents],
  );
  const controlEnabled = !readOnly && observation === "OBSERVED" && snapshot != null;
  const paused = snapshot?.runtime.paused ?? null;
  const observedPaused = observation === "OBSERVED" ? paused : null;
  const freshness = observation === "OBSERVED"
    ? deriveRuntimeFreshness(snapshot?.generatedAt ?? null)
    : "UNOBSERVED";
  const attentionItems = (snapshot?.workItems ?? [])
    .filter((item) => ["CLAIMED", "RUNNING", "NEEDS_REVIEW", "BLOCKED", "FAILED_RETRYABLE", "FAILED_FINAL"].includes(item.status))
    .slice(0, 10);
  const heroMetrics: Array<{ label: string; value: string; tone: string; Icon: LucideIcon }> = [
    { label: "HEALTH", value: snapshot?.runtime.overallHealth ?? "UNOBSERVED", tone: snapshot?.runtime.overallHealth ?? "UNOBSERVED", Icon: Activity },
    { label: "WORKING NOW", value: formatNumber(snapshot?.summary.workingNow ?? null), tone: "RUNNING", Icon: Loader2 },
    { label: "IN QUEUE", value: formatNumber(snapshot?.summary.inQueue ?? null), tone: "CLAIMED", Icon: Clock3 },
    { label: "BLOCKED", value: formatNumber(snapshot?.summary.blocked ?? null), tone: (snapshot?.summary.blocked ?? 0) > 0 ? "ATTENTION" : "IDLE", Icon: AlertTriangle },
    { label: "SOLVED TODAY", value: formatNumber(snapshot?.summary.solvedToday ?? null), tone: "COMPLETED", Icon: CheckCircle2 },
    { label: "DISCOVERED", value: snapshot?.summary.discoveredToday == null ? "UNOBSERVED" : formatNumber(snapshot.summary.discoveredToday), tone: "UNOBSERVED", Icon: CircleHelp },
    { label: "APPROVALS", value: formatNumber(snapshot?.summary.approvals ?? null), tone: (snapshot?.summary.approvals ?? 0) > 0 ? "ATTENTION" : "IDLE", Icon: Users },
    { label: "COST TODAY", value: formatCost(snapshot?.usage.dailyCostUsd ?? null), tone: "IDLE", Icon: WalletCards },
  ];

  async function sendControl(action: ControlAction) {
    const requestId = retryRequestId.trim();
    if (action === "RETRY_CASE" && !requestId) return;
    setPendingAction(action);
    setControlError("");
    setControlMessage("");
    try {
      const response = await fetch(RUNTIME_CONTROL_URL, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action,
          requestId: action === "RETRY_CASE" ? requestId : undefined,
          idempotencyKey: `ui:${crypto.randomUUID()}`,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          textValue(asRecord(payload).error) ??
            "No se pudo completar el control",
        );
      }
      setControlMessage(
        action === "PAUSE"
          ? "Pausa solicitada y confirmada por la API."
          : action === "RESUME"
            ? "Reanudación solicitada y confirmada por la API."
            : `Reintento solicitado para ${requestId}.`,
      );
      if (action === "RETRY_CASE") setRetryRequestId("");
      await refresh();
    } catch (caught) {
      setControlError(
        caught instanceof Error
          ? caught.message
          : "No se pudo completar el control",
      );
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <section aria-labelledby="runtime-control-center-title" className="space-y-5">
      <Card className="border-cyan-500/20 bg-gradient-to-br from-slate-950 via-cyan-950/20 to-slate-950 text-slate-100">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <CardTitle id="runtime-control-center-title" className="flex items-center gap-2">
                <ServerCog className="text-cyan-300" />
                {readOnly ? "Autonomous Operations" : "Centro de Control runtime"}
              </CardTitle>
              <CardDescription className="mt-2 text-slate-400">
                Estado observado por la API canónica de Company OS. La ausencia de telemetría se muestra como UNKNOWN o UNOBSERVED; nunca se infiere OFFLINE.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={statusTone(observation)}>
                API {observation}
              </Badge>
              <Badge
                variant="outline"
                className={statusTone(
                  observedPaused == null
                    ? "UNKNOWN"
                    : observedPaused
                      ? "PAUSED"
                      : "IDLE",
                )}
              >
                Runtime {observedPaused == null ? "UNKNOWN" : observedPaused ? "PAUSED" : "ENABLED"}
              </Badge>
              <Badge variant="outline">
                Concurrencia {formatNumber(observation === "OBSERVED" ? snapshot?.runtime.globalConcurrency ?? null : null)}
              </Badge>
              <Badge variant="outline" className={statusTone(freshness)}>
                Freshness {freshness}
              </Badge>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void refresh()}
                disabled={refreshing}
              >
                {refreshing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Actualizar
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3 text-xs text-slate-400">
            <span>Snapshot: {formatTimestamp(snapshot?.generatedAt ?? null)}</span>
            <span>Edad: {formatAge(snapshot?.generatedAt ?? null)}</span>
            <span>Polling: 15 segundos</span>
            {readOnly && <span>Fase 1: observación sin mutaciones</span>}
          </div>
          {error && (
            <p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
              Actualización no observada: {error}. Se conserva el último snapshot sólo como referencia; no se infiere una caída.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        {heroMetrics.map(({ label, value, tone, Icon }) => (
          <Card key={label} className="border-white/10 bg-slate-950/80 text-slate-100">
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold tracking-wide text-slate-500">{label}</p>
                <Icon className={`h-4 w-4 ${statusTone(tone).split(" ").at(-1) ?? "text-slate-400"}`} />
              </div>
              <p className={`mt-2 text-xl font-black ${statusTone(tone).split(" ").at(-1) ?? "text-slate-100"}`}>{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-white/10 bg-slate-950/80 text-slate-100">
        <CardHeader>
          <CardTitle>Atención operativa</CardTitle>
          <CardDescription className="text-slate-400">
            Máximo diez work items activos o problemáticos, ordenados por actualización del control plane.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {attentionItems.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr className="border-b border-white/10">
                    <th className="px-2 py-3">Misión</th>
                    <th className="px-2 py-3">Estado</th>
                    <th className="px-2 py-3">Agente</th>
                    <th className="px-2 py-3">Prioridad</th>
                    <th className="px-2 py-3">Intento</th>
                    <th className="px-2 py-3">Lease</th>
                    <th className="px-2 py-3">Edad</th>
                  </tr>
                </thead>
                <tbody>
                  {attentionItems.map((item) => (
                    <tr key={item.id} className="border-b border-white/5 align-top">
                      <td className="max-w-sm px-2 py-3">
                        <p className="font-medium text-slate-200">{item.objective}</p>
                        <p className="mt-1 break-all text-xs text-slate-500">{item.requestId}</p>
                      </td>
                      <td className="px-2 py-3"><Badge variant="outline" className={statusTone(item.status)}>{item.status}</Badge></td>
                      <td className="px-2 py-3 text-slate-300">{item.agentId}</td>
                      <td className="px-2 py-3">{formatNumber(item.priority)}</td>
                      <td className="px-2 py-3">{formatNumber(item.attemptCount)} / {formatNumber(item.maxAttempts)}</td>
                      <td className="px-2 py-3 text-xs text-slate-400">
                        {item.lease ? `${item.lease.status} · slot ${formatNumber(item.lease.slotNo)} · ${item.lease.workerId ?? "UNOBSERVED"}` : "Sin lease"}
                      </td>
                      <td className="px-2 py-3 text-slate-400">{formatAge(item.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-slate-600 p-4 text-sm text-slate-400">
              {observation === "OBSERVED" ? "Sin trabajo activo o problemático observado." : "Atención operativa UNOBSERVED."}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
        <Card className="border-white/10 bg-slate-950/80 text-slate-100">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="text-emerald-300" /> Workers
            </CardTitle>
            <CardDescription className="text-slate-400">
              Heartbeat ocioso y trabajo actual reportados por cada proceso.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {snapshot?.workers.length ? (
              snapshot.workers.map((worker, index) => (
                <div key={`${worker.workerId}-${index}`} className="rounded-xl border border-white/10 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{worker.workerId}</p>
                      <p className="text-xs text-slate-400">
                        {worker.host ?? "UNOBSERVED"} · versión {worker.version ?? "UNOBSERVED"}
                      </p>
                    </div>
                    <Badge variant="outline" className={statusTone(observation === "OBSERVED" ? worker.state : "UNKNOWN")}>
                      {observation === "OBSERVED" ? worker.state : "UNKNOWN"}
                    </Badge>
                  </div>
                  <dl className="mt-3 grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
                    <div><dt className="text-slate-500">Inicio</dt><dd>{formatTimestamp(worker.startedAt)}</dd></div>
                    <div><dt className="text-slate-500">Último heartbeat</dt><dd>{formatTimestamp(worker.lastHeartbeatAt)}</dd></div>
                    <div className="sm:col-span-2"><dt className="text-slate-500">Trabajo actual</dt><dd className="break-words">{currentWorkLabel(worker.currentWork)}</dd></div>
                  </dl>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-slate-600 p-4 text-sm text-slate-400">
                <Badge variant="outline" className={statusTone("UNKNOWN")}>UNKNOWN</Badge>
                <p className="mt-2">No hay workers observados en este snapshot.</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-slate-950/80 text-slate-100">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="text-violet-300" /> Jerarquía de agentes
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {hierarchy.length ? hierarchy.map(({ agent, depth }, index) => (
              <div
                key={`${agent.agentId}-${index}`}
                className="rounded-xl border border-white/10 p-3"
                style={{ marginLeft: `${Math.min(depth, 4) * 1.1}rem` }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold">{agent.name}</p>
                    <p className="text-xs text-slate-500">{agent.agentId}</p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant="outline" className={statusTone(agent.installationStatus)}>
                      {agent.installationStatus}
                    </Badge>
                    <Badge variant="outline" className={statusTone(observation === "OBSERVED" ? agent.status : "UNKNOWN")}>
                      {observation === "OBSERVED" ? agent.status : "UNKNOWN"}
                    </Badge>
                  </div>
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  Reporta a: {agent.reportsToAgentId ?? "Raíz"} · Caso actual: {agent.currentCaseId ?? "Ninguno"}
                </p>
              </div>
            )) : (
              <p className="rounded-xl border border-dashed border-slate-600 p-4 text-sm text-slate-400">
                Jerarquía UNOBSERVED. No se asumen agentes instalados.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-white/10 bg-slate-950/80 text-slate-100">
        <CardHeader>
          <CardTitle>Cola durable</CardTitle>
          <CardDescription className="text-slate-400">Conteos autoritativos del control plane.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {(snapshot ? queueMetrics(snapshot) : queueMetrics(normalizeRuntimeControlCenterSnapshot({}))).map(([label, value]) => (
            <div key={label} className="rounded-xl border border-white/10 p-3">
              <p className="text-xs text-slate-500">{label}</p>
              <p className="mt-1 text-2xl font-black">{formatNumber(value)}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="border-white/10 bg-slate-950/80 text-slate-100">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><CalendarClock className="text-cyan-300" /> Schedules</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {snapshot?.schedules.length ? snapshot.schedules.map((schedule, index) => (
              <div key={`${schedule.id}-${index}`} className="rounded-xl border border-white/10 p-3">
                <div className="flex flex-wrap justify-between gap-2">
                  <div><p className="font-semibold">{schedule.scheduleKey}</p><p className="text-xs text-slate-500">{schedule.agentId}</p></div>
                  <Badge variant="outline" className={statusTone(schedule.enabled == null ? "UNKNOWN" : schedule.enabled ? "IDLE" : "PAUSED")}>
                    {schedule.enabled == null ? "UNKNOWN" : schedule.enabled ? "ENABLED" : "DISABLED"}
                  </Badge>
                </div>
                <p className="mt-2 text-xs text-slate-400">Próxima: {formatTimestamp(schedule.nextRunAt)} · Última: {formatTimestamp(schedule.lastRunAt)}</p>
              </div>
            )) : <p className="text-sm text-slate-500">{observation === "OBSERVED" ? "Sin schedules reportados en este snapshot." : "Schedules UNOBSERVED."}</p>}
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-slate-950/80 text-slate-100">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><WalletCards className="text-emerald-300" /> Consumo observado</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-white/10 p-3"><p className="text-xs text-slate-500">Tokens diarios</p><p className="font-bold">{formatNumber(snapshot?.usage.dailyTokens ?? null)}</p></div>
              <div className="rounded-xl border border-white/10 p-3"><p className="text-xs text-slate-500">Costo diario</p><p className="font-bold">{formatCost(snapshot?.usage.dailyCostUsd ?? null)}</p></div>
              <div className="rounded-xl border border-white/10 p-3"><p className="text-xs text-slate-500">Tokens mensuales</p><p className="font-bold">{formatNumber(snapshot?.usage.monthlyTokens ?? null)}</p></div>
              <div className="rounded-xl border border-white/10 p-3"><p className="text-xs text-slate-500">Costo mensual</p><p className="font-bold">{formatCost(snapshot?.usage.monthlyCostUsd ?? null)}</p></div>
            </div>
            {snapshot?.usage.byAgentModel.length ? snapshot.usage.byAgentModel.map((item, index) => (
              <div key={`${item.agentId}-${item.model}-${index}`} className="rounded-xl border border-white/10 p-3 text-xs">
                <p className="font-semibold text-slate-200">{item.agentId} · {item.model}</p>
                <p className="mt-1 text-slate-400">
                  Día: {formatNumber(item.dailyTokens)} tokens · {formatCost(item.dailyCostUsd)} · Mes: {formatNumber(item.monthlyTokens)} tokens · {formatCost(item.monthlyCostUsd)}
                </p>
                {(item.tokens != null || item.costUsd != null) && <p className="mt-1 text-slate-500">Total reportado: {formatNumber(item.tokens)} tokens · {formatCost(item.costUsd)}</p>}
              </div>
            )) : <p className="text-sm text-slate-500">{observation === "OBSERVED" ? "Sin desglose reportado por agente y modelo." : "Consumo por agente y modelo UNOBSERVED."}</p>}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="border-white/10 bg-slate-950/80 text-slate-100">
          <CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="text-amber-300" /> Incidentes</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {snapshot?.incidents.length ? snapshot.incidents.map((incident, index) => (
              <div key={`${incident.id}-${index}`} className="rounded-xl border border-white/10 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">{incident.summary}</p><div className="flex gap-1"><Badge variant="outline" className={statusTone(incident.severity)}>{incident.severity}</Badge><Badge variant="outline" className={statusTone(incident.status)}>{incident.status}</Badge></div></div>
                <p className="mt-2 text-xs text-slate-400">{incident.type} · {formatTimestamp(incident.createdAt)}</p>
              </div>
            )) : <p className="text-sm text-slate-500">{observation === "OBSERVED" ? "Sin incidentes reportados en este snapshot." : "Incidentes UNOBSERVED."}</p>}
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-slate-950/80 text-slate-100">
          <CardHeader><CardTitle className="flex items-center gap-2"><GitBranch className="text-violet-300" /> Dependencias</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {snapshot?.dependencies.length ? snapshot.dependencies.map((dependency, index) => (
              <div key={`${dependency.key}-${index}`} className="rounded-xl border border-white/10 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">{dependency.key}</p><Badge variant="outline" className={statusTone(observation === "OBSERVED" ? dependency.status : "UNOBSERVED")}>{observation === "OBSERVED" ? dependency.status : "UNOBSERVED"}</Badge></div>
                <p className="mt-2 text-xs text-slate-400">Observado: {formatTimestamp(dependency.observedAt)} · Latencia: {dependency.latencyMs == null ? "UNOBSERVED" : `${dependency.latencyMs} ms`}</p>
              </div>
            )) : (
              <div className="rounded-xl border border-dashed border-slate-600 p-4 text-sm text-slate-400"><Badge variant="outline" className={statusTone("UNOBSERVED")}>UNOBSERVED</Badge><p className="mt-2">No hay dependencias observadas en este snapshot.</p></div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-white/10 bg-slate-950/80 text-slate-100">
        <CardHeader><CardTitle className="flex items-center gap-2"><MessagesSquare className="text-cyan-300" /> Mensajes entre agentes</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {snapshot?.messages.length ? snapshot.messages.map((message, index) => (
            <div key={`${message.id}-${index}`} className="rounded-xl border border-white/10 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold">{message.fromAgentId ?? "UNOBSERVED"} → {message.toAgentId ?? "UNOBSERVED"}</p>{message.status && <Badge variant="outline" className={statusTone(message.status)}>{message.status}</Badge>}</div>
              <p className="mt-1 text-xs text-slate-500">{message.messageType ?? "Tipo UNOBSERVED"} · {formatTimestamp(message.createdAt)}</p>
              <p className="mt-2 break-words text-sm text-slate-300">{message.summary ?? message.content ?? "Contenido UNOBSERVED"}</p>
            </div>
          )) : <p className="text-sm text-slate-500">{observation === "OBSERVED" ? "Sin mensajes reportados en este snapshot." : "Mensajes UNOBSERVED."}</p>}
        </CardContent>
      </Card>

      <Card className="border-cyan-500/20 bg-slate-950/80 text-slate-100">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Clock3 className="text-cyan-300" /> Controles humanos</CardTitle>
          <CardDescription className="text-slate-400">Acciones explícitas, idempotentes y deshabilitadas cuando la lectura runtime no está observada.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={!controlEnabled || paused !== false || pendingAction != null} onClick={() => void sendControl("PAUSE")}>
              {pendingAction === "PAUSE" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CirclePause className="mr-2 h-4 w-4" />} Pausar
            </Button>
            <Button type="button" variant="outline" disabled={!controlEnabled || paused !== true || pendingAction != null} onClick={() => void sendControl("RESUME")}>
              {pendingAction === "RESUME" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CirclePlay className="mr-2 h-4 w-4" />} Reanudar
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <div className="space-y-2">
              <Label htmlFor="runtime-retry-request-id">Request ID para reintento</Label>
              <Input id="runtime-retry-request-id" value={retryRequestId} onChange={(event) => setRetryRequestId(event.target.value)} placeholder="request-id exacto" className="border-white/10 bg-black/30" disabled={readOnly} />
            </div>
            <Button type="button" variant="outline" className="self-end" disabled={!controlEnabled || !retryRequestId.trim() || pendingAction != null} onClick={() => void sendControl("RETRY_CASE")}>
              {pendingAction === "RETRY_CASE" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />} Reintentar caso
            </Button>
          </div>
          {controlError && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{controlError}</p>}
          {controlMessage && <p aria-live="polite" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300">{controlMessage}</p>}
        </CardContent>
      </Card>
    </section>
  );
}
