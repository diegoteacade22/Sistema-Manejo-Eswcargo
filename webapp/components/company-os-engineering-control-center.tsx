"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Cpu,
  GitPullRequest,
  KeyRound,
  Loader2,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  TimerReset,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const ENGINEERING_CONTROL_CENTER_URL = "/api/company-os/engineering/v2/control-center";
const ENGINEERING_CONTROL_URL = "/api/company-os/engineering/v2/control";
const POLL_INTERVAL_MS = 15_000;

type ObservationState = "LOADING" | "OBSERVED" | "UNOBSERVED";
type EngineeringControlAction =
  | "PAUSE_INTAKE"
  | "RESUME_INTAKE"
  | "PAUSE_EXECUTION"
  | "RESUME_EXECUTION"
  | "EMERGENCY_STOP"
  | "CLEAR_EMERGENCY";

type EngineeringMission = {
  id: string;
  requestId: string | null;
  objective: string;
  repository: string | null;
  autonomyLevel: string;
  status: string;
  budgetUsd: number | null;
  spentUsd: number | null;
  stateVersion: number | null;
  fencingCounter: string | null;
  deadline: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type EngineeringLease = {
  id: string;
  missionId: string;
  actor: string;
  autonomyLevel: string;
  status: string;
  fencingToken: string | null;
  expectedStateVersion: number | null;
  issuedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
};

type EngineeringEffect = {
  id: string;
  missionId: string;
  verb: string;
  status: string;
  targetRepository: string | null;
  targetHeadBranch: string | null;
  fencingToken: string | null;
  remoteProvider: string | null;
  remoteId: string | null;
  remoteUrl: string | null;
  remoteReadbackHash: string | null;
  confirmedAt: string | null;
  reconciledAt: string | null;
  updatedAt: string | null;
};

type EngineeringEvent = {
  id: string;
  missionId: string;
  sequence: number | null;
  eventType: string;
  fromStatus: string | null;
  toStatus: string;
  eventHash: string | null;
  previousHash: string | null;
  fencingToken: string | null;
  createdAt: string | null;
};

export type EngineeringControlCenterSnapshot = {
  generatedAt: string | null;
  control: {
    pauseIntake: boolean;
    pauseExecution: boolean;
    emergencyStop: boolean;
    quarantinedRepositories: string[];
    disabledActors: string[];
    updatedBy: string | null;
    updatedAt: string | null;
  };
  missions: EngineeringMission[];
  leases: EngineeringLease[];
  effects: EngineeringEffect[];
  events: EngineeringEvent[];
};

type ProofGate = {
  key: "PASS_CONTRACT" | "PASS_A1_LOCAL" | "PASS_A2_DRAFT_PR" | "PASS_DURABLE_V2";
  state: "PASS" | "PENDING" | "UNOBSERVED";
  detail: string;
};

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
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function booleanFailClosed(value: unknown) {
  return typeof value === "boolean" ? value : true;
}

function textArray(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((item) => (typeof item === "string" && item.trim() ? [item.trim()] : []))
    : [];
}

function stateValue(value: unknown, fallback = "UNKNOWN") {
  return textValue(value)?.toUpperCase() ?? fallback;
}

export function normalizeEngineeringControlCenterSnapshot(input: unknown): EngineeringControlCenterSnapshot {
  const source = asRecord(input);
  const control = asRecord(source.control);
  return {
    generatedAt: textValue(source.generatedAt),
    control: {
      pauseIntake: booleanFailClosed(control.pauseIntake),
      pauseExecution: booleanFailClosed(control.pauseExecution),
      emergencyStop: booleanFailClosed(control.emergencyStop),
      quarantinedRepositories: textArray(control.quarantinedRepositories),
      disabledActors: textArray(control.disabledActors),
      updatedBy: textValue(control.updatedBy),
      updatedAt: textValue(control.updatedAt),
    },
    missions: records(source.missions).map((mission) => ({
      id: textValue(mission.id) ?? "UNOBSERVED",
      requestId: textValue(mission.requestId),
      objective: textValue(mission.objective) ?? "Objetivo UNOBSERVED",
      repository: textValue(mission.repository),
      autonomyLevel: stateValue(mission.autonomyLevel),
      status: stateValue(mission.status),
      budgetUsd: numberValue(mission.budgetUsd),
      spentUsd: numberValue(mission.spentUsd),
      stateVersion: numberValue(mission.stateVersion),
      fencingCounter: textValue(mission.fencingCounter),
      deadline: textValue(mission.deadline),
      createdAt: textValue(mission.createdAt),
      updatedAt: textValue(mission.updatedAt),
    })),
    leases: records(source.leases).map((lease) => ({
      id: textValue(lease.id) ?? "UNOBSERVED",
      missionId: textValue(lease.missionId) ?? "UNOBSERVED",
      actor: textValue(lease.actor) ?? "UNOBSERVED",
      autonomyLevel: stateValue(lease.autonomyLevel),
      status: stateValue(lease.status),
      fencingToken: textValue(lease.fencingToken),
      expectedStateVersion: numberValue(lease.expectedStateVersion),
      issuedAt: textValue(lease.issuedAt),
      expiresAt: textValue(lease.expiresAt),
      revokedAt: textValue(lease.revokedAt),
    })),
    effects: records(source.effects).map((effect) => ({
      id: textValue(effect.id) ?? "UNOBSERVED",
      missionId: textValue(effect.missionId) ?? "UNOBSERVED",
      verb: stateValue(effect.verb),
      status: stateValue(effect.status),
      targetRepository: textValue(effect.targetRepository),
      targetHeadBranch: textValue(effect.targetHeadBranch),
      fencingToken: textValue(effect.fencingToken),
      remoteProvider: textValue(effect.remoteProvider),
      remoteId: textValue(effect.remoteId),
      remoteUrl: textValue(effect.remoteUrl),
      remoteReadbackHash: textValue(effect.remoteReadbackHash),
      confirmedAt: textValue(effect.confirmedAt),
      reconciledAt: textValue(effect.reconciledAt),
      updatedAt: textValue(effect.updatedAt),
    })),
    events: records(source.events).map((event) => ({
      id: textValue(event.id) ?? "UNOBSERVED",
      missionId: textValue(event.missionId) ?? "UNOBSERVED",
      sequence: numberValue(event.sequence),
      eventType: textValue(event.eventType) ?? "UNOBSERVED",
      fromStatus: textValue(event.fromStatus),
      toStatus: stateValue(event.toStatus),
      eventHash: textValue(event.eventHash),
      previousHash: textValue(event.previousHash),
      fencingToken: textValue(event.fencingToken),
      createdAt: textValue(event.createdAt),
    })),
  };
}

export function deriveEngineeringFreshness(value: string | null, now = Date.now()) {
  if (!value) return "UNOBSERVED" as const;
  const observedAt = Date.parse(value);
  if (!Number.isFinite(observedAt) || observedAt > now + 5_000) return "UNOBSERVED" as const;
  const age = now - observedAt;
  if (age <= 30_000) return "CURRENT" as const;
  if (age <= 150_000) return "STALE" as const;
  return "UNOBSERVED" as const;
}

export function deriveEngineeringProofGates(
  snapshot: EngineeringControlCenterSnapshot | null,
  observed: boolean,
): ProofGate[] {
  if (!observed || !snapshot) {
    return (["PASS_CONTRACT", "PASS_A1_LOCAL", "PASS_A2_DRAFT_PR", "PASS_DURABLE_V2"] as const)
      .map((key) => ({ key, state: "UNOBSERVED" as const, detail: "Fuente canónica no observada." }));
  }
  const completedA1 = snapshot.missions.filter((mission) => mission.autonomyLevel === "A1" && mission.status === "COMPLETED");
  const confirmedA2Effects = snapshot.effects.filter((effect) =>
    effect.status === "CONFIRMED" && effect.verb === "CREATE_DRAFT_PR" && Boolean(effect.remoteReadbackHash),
  );
  const completedA2 = snapshot.missions.filter((mission) =>
    mission.autonomyLevel === "A2" && mission.status === "COMPLETED"
      && confirmedA2Effects.some((effect) => effect.missionId === mission.id),
  );
  const eventTypes = new Set(snapshot.events.map((event) => event.eventType));
  const durableEvidence = [
    "LEASE_EXPIRED_RECOVERY",
    "STALE_FENCE_REJECTED",
    "EMERGENCY_STOP_VERIFIED",
    "UNKNOWN_OUTCOME_RECONCILED",
  ];
  const durableComplete = completedA2.length > 0 && durableEvidence.every((event) => eventTypes.has(event));
  return [
    {
      key: "PASS_CONTRACT",
      state: "UNOBSERVED",
      detail: "La API operativa no expone un recibo versionado de pruebas de contrato.",
    },
    {
      key: "PASS_A1_LOCAL",
      state: completedA1.length > 0 ? "PASS" : "PENDING",
      detail: completedA1.length > 0 ? `${completedA1.length} misión A1 completada.` : "Sin misión A1 completada en estado canónico.",
    },
    {
      key: "PASS_A2_DRAFT_PR",
      state: completedA2.length > 0 ? "PASS" : "PENDING",
      detail: completedA2.length > 0
        ? `${completedA2.length} misión A2 con Draft PR y readback.`
        : "Sin misión A2 completada con efecto CONFIRMED y readback.",
    },
    {
      key: "PASS_DURABLE_V2",
      state: durableComplete ? "PASS" : "PENDING",
      detail: durableComplete
        ? "Recuperación, fencing, parada y reconciliación observados."
        : `Faltan eventos: ${durableEvidence.filter((event) => !eventTypes.has(event)).join(", ") || "A2 confirmado"}.`,
    },
  ];
}

function formatTimestamp(value: string | null) {
  if (!value) return "UNOBSERVED";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("es-AR", { timeZone: "America/New_York" })
    : "UNOBSERVED";
}

function shortId(value: string | null) {
  if (!value) return "—";
  return value.length > 14 ? `${value.slice(0, 10)}…` : value;
}

function badgeClass(state: string) {
  if (["PASS", "CURRENT", "COMPLETED", "CONFIRMED", "ACTIVE"].includes(state)) {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  }
  if (["UNKNOWN_OUTCOME", "EMERGENCY", "FAILED", "FAILED_FINAL", "UNOBSERVED"].includes(state)) {
    return "border-rose-500/30 bg-rose-500/10 text-rose-300";
  }
  return "border-amber-500/30 bg-amber-500/10 text-amber-300";
}

function StatusBadge({ value }: { value: string }) {
  return <Badge variant="outline" className={badgeClass(value)}>{value}</Badge>;
}

function MetricCard({ label, value, detail, danger = false }: { label: string; value: string | number; detail: string; danger?: boolean }) {
  return (
    <Card className={danger ? "border-rose-500/30 bg-rose-950/20" : "border-slate-800 bg-slate-950/70"}>
      <CardHeader className="pb-2"><CardDescription>{label}</CardDescription><CardTitle className="text-2xl">{value}</CardTitle></CardHeader>
      <CardContent className="text-xs text-slate-400">{detail}</CardContent>
    </Card>
  );
}

const ACTION_LABELS: Record<EngineeringControlAction, string> = {
  PAUSE_INTAKE: "Pausar intake",
  RESUME_INTAKE: "Reanudar intake",
  PAUSE_EXECUTION: "Pausar ejecución",
  RESUME_EXECUTION: "Reanudar ejecución",
  EMERGENCY_STOP: "Activar emergency stop",
  CLEAR_EMERGENCY: "Limpiar emergency stop",
};

export function CompanyOsEngineeringControlCenter() {
  const [snapshot, setSnapshot] = useState<EngineeringControlCenterSnapshot | null>(null);
  const [observation, setObservation] = useState<ObservationState>("LOADING");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<EngineeringControlAction | null>(null);
  const [armed, setArmed] = useState<EngineeringControlAction | null>(null);
  const [clock, setClock] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(ENGINEERING_CONTROL_CENTER_URL, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const normalized = normalizeEngineeringControlCenterSnapshot(await response.json());
      if (!normalized.generatedAt) throw new Error("generatedAt ausente");
      setSnapshot(normalized);
      setObservation("OBSERVED");
      setError(null);
    } catch (cause) {
      setSnapshot(null);
      setObservation("UNOBSERVED");
      setError(cause instanceof Error ? cause.message : "Fuente no disponible");
      setArmed(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const poll = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    const tick = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => { window.clearInterval(poll); window.clearInterval(tick); };
  }, [refresh]);

  const freshness = deriveEngineeringFreshness(snapshot?.generatedAt ?? null, clock);
  const canMutate = observation === "OBSERVED" && freshness === "CURRENT" && snapshot != null && busy == null;
  const control = snapshot?.control ?? {
    pauseIntake: true,
    pauseExecution: true,
    emergencyStop: true,
    quarantinedRepositories: [],
    disabledActors: [],
    updatedBy: null,
    updatedAt: null,
  };

  const performControl = useCallback(async (action: EngineeringControlAction) => {
    if (!canMutate || armed !== action) return;
    setBusy(action);
    try {
      const response = await fetch(ENGINEERING_CONTROL_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, idempotencyKey: `operations-ui:${action}:${crypto.randomUUID()}` }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(asRecord(body).error as string || `HTTP ${response.status}`);
      setArmed(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Control rechazado");
      setObservation("UNOBSERVED");
      setSnapshot(null);
      setArmed(null);
    } finally {
      setBusy(null);
    }
  }, [armed, canMutate, refresh]);

  const activeLeases = snapshot?.leases.filter((lease) => lease.status === "ACTIVE") ?? [];
  const unknownEffects = snapshot?.effects.filter((effect) => effect.status === "UNKNOWN_OUTCOME") ?? [];
  const activeMissions = snapshot?.missions.filter((mission) => !["COMPLETED", "FAILED_FINAL", "CANCELLED"].includes(mission.status)) ?? [];
  const proofGates = useMemo(
    () => deriveEngineeringProofGates(snapshot, observation === "OBSERVED" && freshness !== "UNOBSERVED"),
    [freshness, observation, snapshot],
  );
  const timeline = useMemo(
    () => [...(snapshot?.events ?? [])].sort((a, b) => {
      const time = Date.parse(b.createdAt ?? "") - Date.parse(a.createdAt ?? "");
      return Number.isFinite(time) && time !== 0 ? time : (b.sequence ?? 0) - (a.sequence ?? 0);
    }).slice(0, 30),
    [snapshot?.events],
  );

  const requestAction = (action: EngineeringControlAction) => {
    if (!canMutate) return;
    if (armed === action) void performControl(action);
    else setArmed(action);
  };

  return (
    <section aria-labelledby="engineering-v2-title" className="space-y-5">
      <Card className="border-cyan-500/20 bg-gradient-to-br from-slate-950 via-cyan-950/10 to-slate-950">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <CardTitle id="engineering-v2-title" className="flex items-center gap-2 text-xl"><Cpu className="h-5 w-5 text-cyan-300" /> Ingeniería Autónoma V2</CardTitle>
              <CardDescription className="mt-2">Estado canónico, effects ledger y controles humanos. Ningún estado se infiere desde logs.</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge value={observation === "OBSERVED" ? freshness : observation} />
              <Badge variant="outline" className="border-slate-700 text-slate-300">Fuente: engineering/v2/control-center</Badge>
              <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={busy != null}>
                {observation === "LOADING" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />} Actualizar
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {observation !== "OBSERVED" || freshness === "UNOBSERVED" ? (
            <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-950/30 p-4 text-sm text-rose-200">
              <div className="flex items-center gap-2 font-semibold"><ShieldAlert className="h-4 w-4" /> TELEMETRÍA UNOBSERVED · controles bloqueados</div>
              <p className="mt-1 text-rose-300/80">{error ?? "La observación no es suficientemente reciente."} Las pausas se representan activas por fail-closed.</p>
            </div>
          ) : null}
          <p className="mt-3 text-xs text-slate-500">Observado: {formatTimestamp(snapshot?.generatedAt ?? null)} · Control actualizado: {formatTimestamp(control.updatedAt)}</p>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <MetricCard label="CONTROL" value={control.emergencyStop ? "STOP" : control.pauseExecution ? "PAUSED" : "ARMED"} detail={control.pauseIntake ? "Intake pausado" : "Intake abierto"} danger={control.emergencyStop} />
        <MetricCard label="MISIONES ACTIVAS" value={activeMissions.length} detail={`${snapshot?.missions.length ?? 0} observadas`} />
        <MetricCard label="LEASES ACTIVOS" value={activeLeases.length} detail="Capability + fencing" />
        <MetricCard label="EFFECTS UNKNOWN" value={unknownEffects.length} detail="Bloquean completion/retry" danger={unknownEffects.length > 0} />
        <MetricCard label="RUNNER / ACTOR" value={activeLeases[0]?.actor ?? "—"} detail={activeLeases.length ? "Observado por lease" : "Heartbeat dedicado en panel runtime"} />
        <MetricCard label="COSTO OBSERVADO" value={`$${(snapshot?.missions.reduce((sum, mission) => sum + (mission.spentUsd ?? 0), 0) ?? 0).toFixed(4)}`} detail="spentUsd de misiones cargadas" />
      </div>

      <Card className="border-slate-800 bg-slate-950/70">
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4 text-cyan-300" /> Controles humanos fail-closed</CardTitle><CardDescription>Primer clic arma la acción; segundo clic la confirma. Cualquier fallo vuelve a UNOBSERVED.</CardDescription></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {([
            control.pauseIntake ? "RESUME_INTAKE" : "PAUSE_INTAKE",
            control.pauseExecution ? "RESUME_EXECUTION" : "PAUSE_EXECUTION",
            control.emergencyStop ? "CLEAR_EMERGENCY" : "EMERGENCY_STOP",
          ] as EngineeringControlAction[]).map((action) => (
            <Button
              key={action}
              variant={action === "EMERGENCY_STOP" ? "destructive" : "outline"}
              disabled={!canMutate}
              onClick={() => requestAction(action)}
              aria-pressed={armed === action}
            >
              {busy === action ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : action.includes("RESUME") || action === "CLEAR_EMERGENCY" ? <PlayCircle className="mr-2 h-4 w-4" /> : <PauseCircle className="mr-2 h-4 w-4" />}
              {armed === action ? `Confirmar: ${ACTION_LABELS[action]}` : ACTION_LABELS[action]}
            </Button>
          ))}
          {armed ? <Button variant="ghost" onClick={() => setArmed(null)}>Cancelar</Button> : null}
          <div className="w-full pt-2 text-xs text-slate-500">
            Emergency stop también pausa intake/ejecución y revoca leases activos. Limpiarlo no reanuda automáticamente.
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="border-slate-800 bg-slate-950/70">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><CheckCircle2 className="h-4 w-4 text-cyan-300" /> Proof gates</CardTitle><CardDescription>PASS sólo desde evidencia persistida en esta fuente.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {proofGates.map((gate) => (
              <div key={gate.key} className="flex items-start justify-between gap-3 rounded-lg border border-slate-800 p-3">
                <div><div className="font-mono text-xs text-slate-200">{gate.key}</div><div className="mt-1 text-xs text-slate-500">{gate.detail}</div></div>
                <StatusBadge value={gate.state} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-slate-800 bg-slate-950/70">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><KeyRound className="h-4 w-4 text-cyan-300" /> Leases y fencing</CardTitle><CardDescription>La autoridad expirada o revocada nunca se muestra activa.</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            {(snapshot?.leases.slice(0, 10) ?? []).map((lease) => (
              <div key={lease.id} className="grid gap-2 rounded-lg border border-slate-800 p-3 text-xs sm:grid-cols-[1.2fr_.8fr_.8fr]">
                <div><div className="font-medium text-slate-200">{lease.actor}</div><div className="text-slate-500">mission {shortId(lease.missionId)}</div></div>
                <div><StatusBadge value={lease.status} /><div className="mt-1 text-slate-500">{lease.autonomyLevel}</div></div>
                <div className="font-mono text-slate-400">fence {lease.fencingToken ?? "—"}<br />state v{lease.expectedStateVersion ?? "—"}</div>
                <div className="sm:col-span-3 text-slate-500">Expira {formatTimestamp(lease.expiresAt)}</div>
              </div>
            ))}
            {snapshot && snapshot.leases.length === 0 ? <p className="text-sm text-slate-500">Sin leases observados.</p> : null}
          </CardContent>
        </Card>
      </div>

      <Card className={unknownEffects.length ? "border-rose-500/30 bg-rose-950/20" : "border-slate-800 bg-slate-950/70"}>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><GitPullRequest className="h-4 w-4 text-cyan-300" /> Effects ledger</CardTitle><CardDescription>UNKNOWN_OUTCOME exige reconciliación; nunca habilita reintento ciego.</CardDescription></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-xs">
            <thead className="border-b border-slate-800 text-slate-500"><tr><th className="p-2">Effect</th><th className="p-2">Misión</th><th className="p-2">Verbo</th><th className="p-2">Estado</th><th className="p-2">Fencing</th><th className="p-2">Destino / readback</th><th className="p-2">Actualizado</th></tr></thead>
            <tbody>
              {(snapshot?.effects.slice(0, 20) ?? []).map((effect) => (
                <tr key={effect.id} className="border-b border-slate-900">
                  <td className="p-2 font-mono">{shortId(effect.id)}</td><td className="p-2 font-mono">{shortId(effect.missionId)}</td><td className="p-2">{effect.verb}</td>
                  <td className="p-2"><StatusBadge value={effect.status} /></td><td className="p-2 font-mono">{effect.fencingToken ?? "—"}</td>
                  <td className="p-2"><div>{effect.targetHeadBranch ?? effect.targetRepository ?? "—"}</div><div className="text-slate-500">{effect.remoteReadbackHash ? `readback ${shortId(effect.remoteReadbackHash)}` : "readback ausente"}</div></td>
                  <td className="p-2 text-slate-500">{formatTimestamp(effect.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {snapshot && snapshot.effects.length === 0 ? <p className="py-4 text-sm text-slate-500">Sin efectos observados.</p> : null}
        </CardContent>
      </Card>

      <Card className="border-slate-800 bg-slate-950/70">
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Clock3 className="h-4 w-4 text-cyan-300" /> Mission timeline</CardTitle><CardDescription>Eventos append-only ordenados por observación; hashes acortados sólo para visualización.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {timeline.map((event) => (
            <div key={event.id} className="grid gap-2 border-l-2 border-cyan-500/30 pl-4 text-xs md:grid-cols-[110px_1fr_180px]">
              <div className="font-mono text-slate-500">#{event.sequence ?? "—"}<br />{shortId(event.missionId)}</div>
              <div><div className="font-medium text-slate-200">{event.eventType}</div><div className="mt-1 flex flex-wrap items-center gap-2 text-slate-500"><span>{event.fromStatus ?? "∅"}</span><span>→</span><StatusBadge value={event.toStatus} />{event.fencingToken ? <span>fence {event.fencingToken}</span> : null}</div></div>
              <div className="text-slate-500">{formatTimestamp(event.createdAt)}<br />hash {shortId(event.eventHash)}</div>
            </div>
          ))}
          {snapshot && timeline.length === 0 ? <p className="text-sm text-slate-500">Sin eventos de misión observados.</p> : null}
        </CardContent>
      </Card>

      {(control.quarantinedRepositories.length > 0 || control.disabledActors.length > 0) ? (
        <Card className="border-amber-500/30 bg-amber-950/20">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4" /> Bloqueos explícitos</CardTitle></CardHeader>
          <CardContent className="grid gap-3 text-xs md:grid-cols-2"><div>Repositorios en cuarentena: {control.quarantinedRepositories.join(", ") || "—"}</div><div>Actores deshabilitados: {control.disabledActors.join(", ") || "—"}</div></CardContent>
        </Card>
      ) : null}

      {unknownEffects.length > 0 ? (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-rose-500/30 bg-rose-950/30 p-4 text-sm text-rose-200">
          <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0" /><div><div className="font-semibold">{unknownEffects.length} efecto(s) UNKNOWN_OUTCOME</div><p className="mt-1 text-rose-300/80">Detener finalización y reconciliar el destino antes de cualquier retry.</p></div>
        </div>
      ) : null}

      {freshness === "STALE" ? (
        <div role="status" className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-950/20 p-3 text-xs text-amber-200"><TimerReset className="h-4 w-4" /> Fuente STALE: lectura visible, controles deshabilitados.</div>
      ) : null}
    </section>
  );
}
