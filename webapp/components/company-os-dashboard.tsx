"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Ban,
  BrainCircuit,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  GitBranch,
  Loader2,
  MessageSquarePlus,
  RefreshCw,
  Send,
  ServerCog,
  ShieldCheck,
  TriangleAlert,
  Upload,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type RequestStatus =
  | "QUEUED"
  | "ANALYZING"
  | "AWAITING_REVIEW"
  | "BLOCKED"
  | "FAILED"
  | "CANCELLED"
  | "COMPLETED";
type MissionStatus =
  | "PLANNED"
  | "APPROVED"
  | "REJECTED"
  | "REVIEW"
  | "BLOCKED"
  | "RUNNING"
  | "DONE";
type ObservationMode =
  "LIVE_OBSERVED" | "DECLARED_FROM_CONFIG" | "INFERRED" | "UNOBSERVED";
type ManagerId =
  | "general-manager-ai-v3"
  | "systems-manager-ai-v1"
  | "data-manager-ai-v1";
type View =
  | "Resumen"
  | "Inbox"
  | "Caso"
  | "Sistemas"
  | "Carga de listas"
  | "Decisiones"
  | "Catálogo";
type GlobalState =
  "IDLE" | "WORKING" | "WAITING_FOR_DIEGO" | "DEGRADED" | "OFFLINE";
type Asset = {
  assetId: string;
  name: string;
  provider: string;
  category: string;
  environment: string;
  lifecycleStatus: string;
  healthStatus: string;
  criticality: string;
  coverageStatus: string;
  observationMode: ObservationMode;
  observationLabel: string;
  warnings: string[];
};
type Dependency = {
  dependencyId: string;
  sourceAssetId: string;
  targetAssetId: string;
  dependencyType: string;
  criticality: string;
  inferenceStatus: string;
  observationMode: ObservationMode;
};
type Risk = {
  riskId: string;
  title: string;
  classification: string;
  priority: number;
  description: string;
  recommendedAction: string;
  missingEvidence: string[];
};
type CaseSummary = {
  id: string;
  requestId: string;
  agentId: ManagerId;
  area: string;
  caseType: string;
  objective: string;
  status: RequestStatus;
  relatedCaseId?: string | null;
  webhookDeliveryStatus: string;
  createdAt: string;
  updatedAt: string;
  messages: Array<{
    id: string;
    role: string;
    kind: string;
    content: string;
    createdAt: string;
  }>;
  missions: Array<{
    id: string;
    title: string;
    rationale: string;
    expectedOutput: string;
    status: MissionStatus;
  }>;
  usage: Array<{
    inputTokens: number;
    cachedTokens: number;
    cacheWriteTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    totalTokens: number;
    estimatedCostUsd: string;
    dailyTotalTokens: number;
    dailyCostUsd: string;
    alertLevel?: number | null;
    responseId?: string | null;
    durationMs?: number | null;
    retries?: number;
    snapshotBytes?: number | null;
    rulesApplied?: string[];
  }>;
  heartbeats: Array<{ createdAt: string; phase: string }>;
  events: Array<{
    id: string;
    sequence: number;
    eventType: string;
    createdAt: string;
    payload?: Record<string, unknown>;
  }>;
  evidence: Array<{
    evidenceKey: string;
    value: unknown;
    observedAt?: string | null;
  }>;
  auditEvents: Array<{
    id: string;
    action: string;
    metadata: Record<string, unknown>;
    createdAt: string;
  }>;
};

const activeStatuses = new Set<RequestStatus>(["QUEUED", "ANALYZING"]);
const reviewMissionStatuses = new Set<MissionStatus>(["PLANNED", "REVIEW"]);
const statusColor: Record<RequestStatus, string> = {
  QUEUED: "border-sky-500/40 text-sky-300",
  ANALYZING: "border-violet-500/40 text-violet-300",
  AWAITING_REVIEW: "border-amber-500/40 text-amber-300",
  BLOCKED: "border-orange-500/40 text-orange-300",
  FAILED: "border-red-500/40 text-red-300",
  CANCELLED: "border-slate-500/40 text-slate-400",
  COMPLETED: "border-emerald-500/40 text-emerald-300",
};
const observationLabels: Record<ObservationMode, string> = {
  LIVE_OBSERVED: "Observado en vivo",
  DECLARED_FROM_CONFIG: "Declarado por configuración",
  INFERRED: "Inferido",
  UNOBSERVED: "No observado",
};

function evidenceOf(companyCase: CaseSummary) {
  return Object.fromEntries(
    companyCase.evidence.map((item) => [item.evidenceKey, item.value]),
  ) as {
    assets?: Asset[];
    dependencies?: Dependency[];
    risks?: Risk[];
    metadata?: {
      coverage?: {
        observed?: string[];
        declared?: string[];
        inferred?: string[];
        unobserved?: string[];
      };
    };
  };
}

export function deriveCompanyOsGlobalState(
  cases: CaseSummary[],
  now = Date.now(),
) {
  const active = cases.filter((item) => activeStatuses.has(item.status));
  const reviews = cases.flatMap((item) =>
    item.missions.filter((mission) => reviewMissionStatuses.has(mission.status)),
  );
  const heartbeatDates = cases
    .flatMap((item) =>
      item.heartbeats.map((heartbeat) =>
        new Date(heartbeat.createdAt).getTime(),
      ),
    )
    .filter(Number.isFinite);
  const lastHeartbeatMs = heartbeatDates.length
    ? Math.max(...heartbeatDates)
    : null;
  const lastHeartbeat = lastHeartbeatMs
    ? new Date(lastHeartbeatMs).toISOString()
    : null;
  const successDates = cases
    .flatMap((item) =>
      item.events
        .filter((event) => event.eventType === "ANALYSIS_COMPLETED")
        .map((event) => new Date(event.createdAt).getTime()),
    )
    .filter(Number.isFinite);
  const lastSuccessMs = successDates.length ? Math.max(...successDates) : null;
  const lastSuccessfulCycle = lastSuccessMs
    ? new Date(lastSuccessMs).toISOString()
    : null;
  const failureDates = cases
    .filter((item) => ["FAILED", "BLOCKED"].includes(item.status))
    .map((item) => new Date(item.updatedAt).getTime())
    .filter(Number.isFinite);
  const lastFailureMs = failureDates.length ? Math.max(...failureDates) : null;
  const latestSystemsCase = cases.find(
    (item) => item.agentId === "systems-manager-ai-v1",
  );
  const worker = latestSystemsCase
    ? evidenceOf(latestSystemsCase).assets?.find(
        (asset) => asset.assetId === "company-os-worker",
      )
    : undefined;
  const activeActivityAges = active.map((item) => {
    const ownHeartbeats = item.heartbeats
      .map((heartbeat) => new Date(heartbeat.createdAt).getTime())
      .filter(Number.isFinite);
    const updatedAt = new Date(item.updatedAt).getTime();
    const latestOwnHeartbeat = ownHeartbeats.length
      ? Math.max(...ownHeartbeats)
      : null;
    return now - (latestOwnHeartbeat ?? (Number.isFinite(updatedAt) ? updatedAt : 0));
  });
  const worstActiveAge = activeActivityAges.length
    ? Math.max(...activeActivityAges)
    : 0;
  const unresolvedFailure =
    lastFailureMs != null &&
    (lastSuccessMs == null || lastFailureMs > lastSuccessMs);
  let state: GlobalState = "IDLE";
  if (
    worker?.observationMode === "LIVE_OBSERVED" &&
    worker.healthStatus === "OFFLINE_CONFIRMED"
  )
    state = "OFFLINE";
  else if (active.length > 0 && worstActiveAge > 15 * 60_000) state = "OFFLINE";
  else if (
    (active.length > 0 && worstActiveAge > 5 * 60_000) ||
    worker?.healthStatus === "DEGRADED" ||
    unresolvedFailure
  )
    state = "DEGRADED";
  else if (active.length > 0) state = "WORKING";
  else if (reviews.length > 0) state = "WAITING_FOR_DIEGO";
  return {
    state,
    lastSuccessfulCycle,
    lastHeartbeat,
    queued: cases.filter((item) => item.status === "QUEUED").length,
    active: active.length,
    reviews: reviews.length,
  };
}

export function deriveAuditSummary(cases: CaseSummary[]) {
  const events = cases.reduce((sum, item) => sum + item.events.length, 0);
  const executionStates = cases.reduce(
    (sum, item) =>
      sum +
      item.missions.filter((mission) =>
        ["RUNNING", "DONE"].includes(mission.status),
      ).length,
    0,
  );
  const auditEvents = cases.flatMap((item) => item.auditEvents ?? []);
  const numeric = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? value : 0;
  const businessWrites = auditEvents.reduce(
    (sum, event) => sum + numeric(event.metadata?.businessWrites),
    0,
  );
  const infrastructureWrites = auditEvents.reduce(
    (sum, event) => sum + numeric(event.metadata?.infrastructureWrites),
    0,
  );
  const expectedAuditActions: Record<string, string> = {
    CASE_QUEUED: "CASE_CREATED",
    CASE_BLOCKED_INPUT_BUDGET: "CASE_CREATED",
    ANALYSIS_COMPLETED: "ANALYSIS_COMPLETED",
    CONTEXT_APPENDED: "CONTEXT_APPENDED",
    CASE_CANCELLED: "CASE_CANCELLED",
    MISSION_DECIDED: "MISSION_DECIDED",
    RISK_REVIEWED: "RISK_REVIEWED",
  };
  const auditCoverageComplete =
    cases.length > 0 &&
    cases.every((item) => {
      const actions = new Set(
        (item.auditEvents ?? []).map((event) => event.action),
      );
      return item.events.every(
        (event) =>
          !expectedAuditActions[event.eventType] ||
          actions.has(expectedAuditActions[event.eventType]),
      );
    });
  return {
    events,
    executionStates,
    advisoryOnly: executionStates === 0,
    auditEvents: auditEvents.length,
    businessWrites,
    infrastructureWrites,
    auditCoverageComplete,
  };
}

function priorityBand(score: number) {
  return score >= 90
    ? "P0"
    : score >= 75
      ? "P1"
      : score >= 50
        ? "P2"
        : score >= 25
          ? "P3"
          : "P4";
}
function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("es-AR") : "Sin registro";
}
function resultContent(content: string) {
  try {
    return JSON.parse(content) as {
      summary?: string;
      primaryDataQualityProblem?: string;
      recommendedNextStep?: string;
      primaryConfirmedRisk?: string;
      primaryCoverageGap?: string;
      confirmedRiskNextStep?: string;
      coverageGapNextStep?: string;
      evidenceRefs?: string[];
    };
  } catch {
    return { summary: content };
  }
}

type ActionDialog = {
  kind: "mission" | "risk";
  id: string;
  decision: string;
  title: string;
  reason: string;
  deferUntil: string;
  mission?: CaseSummary["missions"][number];
  editTitle: string;
  editOutput: string;
} | null;

type DetailDialog = {
  title: string;
  description: string;
  lines: string[];
  caseIds?: string[];
} | null;

const managerConfig: Record<ManagerId, {
  label: string;
  description: string;
  backendAgentId: ManagerId;
  tabs: View[];
}> = {
  "systems-manager-ai-v1": {
    label: "Gerente de Sistemas",
    description: "Salud técnica, procesamiento, regulación y cobertura.",
    backendAgentId: "systems-manager-ai-v1",
    tabs: ["Resumen", "Inbox", "Caso", "Sistemas"],
  },
  "general-manager-ai-v3": {
    label: "Gerente General",
    description: "Prioridades ejecutivas, decisiones y estado global.",
    backendAgentId: "general-manager-ai-v3",
    tabs: ["Resumen", "Inbox", "Caso", "Decisiones"],
  },
  "data-manager-ai-v1": {
    label: "Gerente de Datos",
    description: "Listas de proveedores, calidad de catálogo y actualización de datos.",
    backendAgentId: "data-manager-ai-v1",
    tabs: ["Resumen", "Inbox", "Carga de listas", "Catálogo"],
  },
};

function SystemsEvidence({
  companyCase,
  onRiskAction,
}: {
  companyCase: CaseSummary;
  onRiskAction: (
    risk: Risk,
    decision: "ACKNOWLEDGE" | "POSTPONE" | "MARK_INCORRECT" | "COMMENT",
  ) => void;
}) {
  const [filters, setFilters] = useState({
    environment: "",
    provider: "",
    category: "",
    criticality: "",
    status: "",
    observationMode: "",
  });
  const evidence = evidenceOf(companyCase);
  const assets = evidence.assets ?? [];
  const dependencies = evidence.dependencies ?? [];
  const risks = evidence.risks ?? [];
  const names = new Map(assets.map((asset) => [asset.assetId, asset.name]));
  const options = (
    key: keyof Pick<
      Asset,
      | "environment"
      | "provider"
      | "category"
      | "criticality"
      | "observationMode"
    >,
  ) => [...new Set(assets.map((asset) => asset[key]))].sort();
  const statusOptions = [
    ...new Set(
      assets.flatMap((asset) => [
        asset.lifecycleStatus,
        asset.healthStatus,
        asset.coverageStatus,
      ]),
    ),
  ].sort();
  const filtered = assets.filter(
    (asset) =>
      (!filters.environment || asset.environment === filters.environment) &&
      (!filters.provider || asset.provider === filters.provider) &&
      (!filters.category || asset.category === filters.category) &&
      (!filters.criticality || asset.criticality === filters.criticality) &&
      (!filters.observationMode ||
        asset.observationMode === filters.observationMode) &&
      (!filters.status ||
        [
          asset.lifecycleStatus,
          asset.healthStatus,
          asset.coverageStatus,
        ].includes(filters.status)),
  );
  const control = (
    key: keyof typeof filters,
    label: string,
    values: string[],
  ) => (
    <select
      aria-label={label}
      value={filters[key]}
      onChange={(event) =>
        setFilters((current) => ({ ...current, [key]: event.target.value }))
      }
      className="rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-xs text-slate-200"
    >
      <option value="">{label}: todos</option>
      {values.map((value) => (
        <option key={value}>{value}</option>
      ))}
    </select>
  );
  return (
    <div className="space-y-5">
      <Card className="border-amber-500/20 bg-slate-950/80 text-slate-100">
        <CardHeader>
          <CardTitle className="flex gap-2">
            <TriangleAlert className="text-amber-300" />
            Riesgos y gaps
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {risks.map((risk) => (
            <div
              key={risk.riskId}
              className="rounded-xl border border-white/10 p-4"
            >
              <div className="flex justify-between gap-2">
                <p className="font-semibold">{risk.title}</p>
                <Badge variant="outline">
                  {risk.classification === "ACTION_REQUIRED"
                    ? `${priorityBand(risk.priority)} · Score ${risk.priority}`
                    : risk.classification}
                </Badge>
              </div>
              <p className="mt-2 text-sm text-slate-400">{risk.description}</p>
              <p className="mt-2 text-sm text-cyan-300">
                {risk.recommendedAction}
              </p>
              {risk.missingEvidence.length > 0 && (
                <p className="mt-2 text-xs text-amber-300">
                  Falta: {risk.missingEvidence.join(" · ")}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onRiskAction(risk, "ACKNOWLEDGE")}
                >
                  Reconocer
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onRiskAction(risk, "COMMENT")}
                >
                  Corregir
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onRiskAction(risk, "POSTPONE")}
                >
                  Posponer
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-orange-500/30 text-orange-300"
                  onClick={() => onRiskAction(risk, "MARK_INCORRECT")}
                >
                  Incorrecto
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      <details className="rounded-2xl border border-white/10 bg-slate-950/80 p-4">
        <summary className="cursor-pointer font-semibold text-cyan-200">
          Detalles técnicos · inventario, dependencias y cobertura
        </summary>
        <div className="mt-5 space-y-5">
          <Card className="border-white/10 bg-black/20 text-slate-100">
            <CardHeader>
              <CardTitle className="flex gap-2">
                <Database className="text-cyan-300" />
                Inventario · {filtered.length}/{assets.length}
              </CardTitle>
              <CardDescription className="text-slate-400">
                La procedencia indica qué es monitoreo real y qué es sólo mapa
                contractual.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {control(
                  "observationMode",
                  "Procedencia",
                  options("observationMode"),
                )}
                {control("environment", "Entorno", options("environment"))}
                {control("provider", "Proveedor", options("provider"))}
                {control("category", "Categoría", options("category"))}
                {control("criticality", "Criticidad", options("criticality"))}
                {control("status", "Estado", statusOptions)}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {filtered.map((asset) => (
                  <div
                    key={asset.assetId}
                    className="rounded-xl border border-white/10 p-3"
                  >
                    <div className="flex justify-between gap-2">
                      <div>
                        <p className="font-semibold">{asset.name}</p>
                        <p className="text-xs text-slate-500">
                          {asset.provider} · {asset.category} ·{" "}
                          {asset.environment}
                        </p>
                      </div>
                      <Badge variant="outline">{asset.criticality}</Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <Badge
                        variant="outline"
                        className={
                          asset.observationMode === "LIVE_OBSERVED"
                            ? "border-emerald-500/40 text-emerald-300"
                            : "border-amber-500/30 text-amber-200"
                        }
                      >
                        {observationLabels[asset.observationMode]}
                      </Badge>
                      <Badge variant="outline">{asset.healthStatus}</Badge>
                      <Badge variant="outline">{asset.coverageStatus}</Badge>
                    </div>
                    <p className="mt-2 text-xs text-slate-400">
                      {asset.observationLabel}
                    </p>
                    {asset.warnings.map((warning) => (
                      <p key={warning} className="mt-1 text-xs text-amber-300">
                        {warning}
                      </p>
                    ))}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card className="border-white/10 bg-black/20 text-slate-100">
            <CardHeader>
              <CardTitle className="flex gap-2">
                <GitBranch className="text-violet-300" />
                Dependencias · {dependencies.length}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {dependencies.map((item) => (
                <div
                  key={item.dependencyId}
                  className="rounded-lg border border-white/10 p-3 text-xs"
                >
                  <span className="text-cyan-300">
                    {names.get(item.sourceAssetId) ?? item.sourceAssetId}
                  </span>{" "}
                  →{" "}
                  <span className="text-violet-300">
                    {names.get(item.targetAssetId) ?? item.targetAssetId}
                  </span>{" "}
                  · {item.dependencyType} · {item.criticality} ·{" "}
                  {observationLabels[item.observationMode]}
                </div>
              ))}
            </CardContent>
          </Card>
          <Card className="border-white/10 bg-black/20 text-slate-100">
            <CardHeader>
              <CardTitle>Cobertura por procedencia</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {(
                [
                  ["LIVE_OBSERVED", "observed"],
                  ["DECLARED_FROM_CONFIG", "declared"],
                  ["INFERRED", "inferred"],
                  ["UNOBSERVED", "unobserved"],
                ] as const
              ).map(([mode, key]) => (
                <div key={mode}>
                  <p className="font-semibold text-cyan-200">
                    {observationLabels[mode]}
                  </p>
                  {(evidence.metadata?.coverage?.[key] ?? []).map((item) => (
                    <p key={item} className="text-sm text-slate-400">
                      {mode === "LIVE_OBSERVED" ? "✓" : "—"} {item}
                    </p>
                  ))}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </details>
    </div>
  );
}

export function CompanyOsDashboard() {
  const [agentId, setAgentId] = useState<ManagerId>("systems-manager-ai-v1");
  const [allCases, setAllCases] = useState<CaseSummary[]>([]);
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [reports, setReports] = useState<CaseSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [objective, setObjective] = useState("");
  const [relatedRequestId, setRelatedRequestId] = useState("");
  const [context, setContext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("Resumen");
  const [action, setAction] = useState<ActionDialog>(null);
  const [detail, setDetail] = useState<DetailDialog>(null);
  const [supplierName, setSupplierName] = useState("");
  const [listText, setListText] = useState("");
  const [listFile, setListFile] = useState<File | null>(null);
  const [intakeResult, setIntakeResult] = useState("");
  const selected =
    cases.find((entry) => entry.requestId === selectedId) ?? cases[0];
  const manager = managerConfig[agentId];
  const pendingReviews = useMemo(
    () =>
      allCases.flatMap((companyCase) =>
        companyCase.missions
          .filter((mission) => reviewMissionStatuses.has(mission.status))
          .map((mission) => ({ companyCase, mission })),
      ),
    [allCases],
  );
  const refresh = useCallback(async () => {
    const response = await fetch("/api/company-os/v3/cases?limit=100", {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("No se pudo leer el inbox");
    const payload = await response.json();
    const received = (payload.cases ?? []) as CaseSummary[];
    setAllCases(received);
    const backendAgentId = managerConfig[agentId].backendAgentId;
    setCases(
      received.filter(
        (entry) =>
          entry.agentId === backendAgentId &&
          (agentId !== "data-manager-ai-v1" || entry.caseType.startsWith("DATA_")),
      ),
    );
    setReports(
      agentId === "general-manager-ai-v3"
        ? received.filter((entry) => entry.agentId === "systems-manager-ai-v1")
        : [],
    );
  }, [agentId]);
  useEffect(() => {
    void refresh().catch((caught) => setError(caught.message));
  }, [refresh]);
  useEffect(() => {
    const timer = setInterval(
      () => void refresh().catch(() => undefined),
      45_000,
    );
    return () => clearInterval(timer);
  }, [refresh]);
  const operations = useMemo(
    () => {
      const sourceCases = agentId === "general-manager-ai-v3" ? allCases : cases;
      return deriveCompanyOsGlobalState(sourceCases);
    },
    [agentId, allCases, cases],
  );
  const audit = useMemo(() => deriveAuditSummary(agentId === "general-manager-ai-v3" ? allCases : cases), [agentId, allCases, cases]);
  const totals = useMemo(
    () =>
      cases.reduce(
        (acc, item) => {
          for (const usage of item.usage) {
            acc.tokens += usage.totalTokens;
            acc.cost += Number(usage.estimatedCostUsd);
          }
          return acc;
        },
        { tokens: 0, cost: 0 },
      ),
    [cases],
  );
  const latestRisks = useMemo(() => {
    const latest = allCases.find(
      (item) => item.agentId === "systems-manager-ai-v1",
    );
    return latest ? (evidenceOf(latest).risks ?? []) : [];
  }, [allCases]);

  async function post(url: string, body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error || "No se pudo completar la acción");
      await refresh();
      return payload;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Error inesperado");
    } finally {
      setBusy(false);
    }
  }
  async function createCase() {
    const payload = await post("/api/company-os/v3/cases", {
      objective,
      relatedRequestId: relatedRequestId || undefined,
      agentId: manager.backendAgentId,
      caseType: agentId === "data-manager-ai-v1" ? "DATA_ADVISORY" : undefined,
    });
    if (payload) {
      setObjective("");
      setRelatedRequestId("");
      setSelectedId(payload.requestId);
      setView("Caso");
    }
  }

  async function submitSupplierList() {
    if (!listFile && !listText.trim()) return;
    setBusy(true);
    setError("");
    setIntakeResult("");
    try {
      const form = new FormData();
      if (listFile) form.append("file", listFile);
      if (listText.trim()) form.append("text", listText.trim());
      if (supplierName.trim()) form.append("supplierName", supplierName.trim());
      const response = await fetch("/api/price-opportunities", {
        method: "POST",
        body: form,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo analizar la lista");
      const objective = `Analizar lista de precios de ${supplierName.trim() || "proveedor no identificado"}. Carga ${payload.load?.id ?? "sin-id"}. Fuente: ${payload.sourceName}. ${payload.rowsAnalyzed} filas, ${payload.counts?.OFERTA_PROBABLE ?? 0} ofertas probables y ${payload.counts?.AMBIGUO ?? 0} ambiguas.`;
      const casePayload = await post("/api/company-os/v3/cases", {
        objective,
        agentId: "data-manager-ai-v1",
        caseType: "DATA_INGESTION",
      });
      if (!casePayload?.requestId) throw new Error("La lista se analizó, pero no se pudo crear el caso de Datos");
      setIntakeResult(
        `Lista analizada: ${payload.rowsAnalyzed} filas (carga ${payload.load?.id ?? "sin-id"}). Caso ${casePayload.requestId} enviado al Gerente de Datos.`,
      );
      setListFile(null);
      setListText("");
      setSupplierName("");
      setAgentId("data-manager-ai-v1");
      setView("Inbox");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo cargar la lista");
    } finally {
      setBusy(false);
    }
  }
  async function appendContext() {
    if (!selected || !context.trim()) return;
    const done = await post(
      `/api/company-os/v3/cases/${selected.requestId}/messages`,
      { content: context },
    );
    if (done) setContext("");
  }
  async function decideMission(
    missionId: string,
    decision: string,
    extra: Record<string, unknown> = {},
  ) {
    if (!selected) return;
    return post("/api/company-os/v3/missions", {
      requestId: selected.requestId,
      missionId,
      decision,
      idempotencyKey: crypto.randomUUID(),
      ...extra,
    });
  }
  async function submitAction() {
    if (!action || !selected || !action.reason.trim()) return;
    const deferUntil = action.deferUntil
      ? new Date(action.deferUntil).toISOString()
      : undefined;
    const result =
      action.kind === "risk"
        ? await post("/api/company-os/v3/risks", {
            requestId: selected.requestId,
            riskId: action.id,
            decision: action.decision,
            reason: action.reason.trim(),
            deferUntil,
            idempotencyKey: crypto.randomUUID(),
          })
        : await decideMission(action.id, action.decision, {
            reason: action.reason.trim(),
            deferUntil,
            revision:
              action.decision === "EDIT"
                ? {
                    title: action.editTitle.trim(),
                    expectedOutput: action.editOutput.trim(),
                    rationale: action.reason.trim(),
                  }
                : undefined,
          });
    if (result) setAction(null);
  }
  const openMission = (
    mission: CaseSummary["missions"][number],
    decision: string,
  ) =>
    setAction({
      kind: "mission",
      id: mission.id,
      decision,
      title: `${decision}: ${mission.title}`,
      reason: "",
      deferUntil: "",
      mission,
      editTitle: mission.title,
      editOutput: mission.expectedOutput,
    });
  const openRisk = (risk: Risk, decision: string) =>
    setAction({
      kind: "risk",
      id: risk.riskId,
      decision,
      title: `${decision}: ${risk.title}`,
      reason: "",
      deferUntil: "",
      editTitle: "",
      editOutput: "",
    });
  const actionValid = Boolean(
    action?.reason.trim() &&
    (!action?.decision.includes("POSTPONE") || action.deferUntil) &&
    (action?.decision !== "EDIT" ||
      (action.editTitle.trim() && action.editOutput.trim())),
  );

  return (
    <div className="min-h-screen bg-[#07090f] p-4 text-slate-100 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="rounded-3xl border border-cyan-500/20 bg-gradient-to-br from-slate-950 via-indigo-950/50 to-slate-950 p-6 shadow-2xl">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div>
              <Badge className="mb-3 border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                {agentId} · ADVISORY ONLY
              </Badge>
              <h1 className="flex items-center gap-3 text-3xl font-black">
                <BrainCircuit className="text-cyan-300" />
                Company OS
              </h1>
              <p className="mt-3 max-w-3xl text-sm text-slate-300">
                {manager.label} AI · {manager.description} Análisis advisory-only, sin ejecución autónoma.
              </p>
            </div>
            <Badge variant="outline" className="p-3 text-base">
              <Activity className="mr-2 h-4 w-4" />
              {operations.state}
            </Badge>
          </div>
        </section>
        {error && (
          <p className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </p>
        )}
        <div className="grid gap-2 md:grid-cols-3">
          {(Object.keys(managerConfig) as ManagerId[]).map((id) => (
            <Button
              key={id}
              variant={agentId === id ? "default" : "outline"}
              aria-pressed={agentId === id}
              className="justify-start"
              onClick={() => {
                setAgentId(id);
                setSelectedId("");
                setView("Resumen");
                setDetail(null);
              }}
            >
              {id === "systems-manager-ai-v1" ? (
                <ServerCog className="mr-2 h-4 w-4" />
              ) : id === "data-manager-ai-v1" ? (
                <Database className="mr-2 h-4 w-4" />
              ) : (
                <BrainCircuit className="mr-2 h-4 w-4" />
              )}
              {managerConfig[id].label}
            </Button>
          ))}
        </div>
        <nav
          aria-label="Navegación Company OS"
          className="sticky top-2 z-10 grid grid-cols-4 gap-1 rounded-xl border border-white/10 bg-slate-950/95 p-1 backdrop-blur md:flex"
        >
          {manager.tabs.map((item) => (
            <Button
              key={item}
              size="sm"
              variant={view === item ? "default" : "ghost"}
              onClick={() => setView(item)}
            >
              {item}
            </Button>
          ))}
        </nav>

        {view === "Resumen" && (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Card
                role="button"
                tabIndex={0}
                onClick={() => setDetail({
                  title: "Estado global",
                  description: "Estado derivado de casos, actividad y telemetría observada.",
                  lines: [
                    `Estado: ${operations.state}`,
                    `En cola: ${operations.queued}`,
                    `Activos: ${operations.active}`,
                    `Revisiones pendientes: ${operations.reviews}`,
                    `Último heartbeat: ${formatDate(operations.lastHeartbeat)}`,
                  ],
                })}
                onKeyDown={(event) => event.key === "Enter" && setDetail({
                  title: "Estado global",
                  description: "Estado derivado de casos, actividad y telemetría observada.",
                  lines: [`Estado: ${operations.state}`, `Revisiones pendientes: ${operations.reviews}`],
                })}
                className="cursor-pointer border-white/10 bg-slate-950/80 text-slate-100 transition hover:border-cyan-400/50"
              >
                <CardHeader>
                  <CardDescription>Estado global</CardDescription>
                  <CardTitle>{operations.state}</CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-slate-400">
                  Todos los agentes · refresco permanente cada 45 segundos.
                </CardContent>
              </Card>
              <Card
                role="button"
                tabIndex={0}
                onClick={() => setDetail({
                  title: "Operación y revisiones",
                  description: "Casos y misiones que requieren seguimiento desde esta pantalla.",
                  lines: pendingReviews.length
                    ? pendingReviews.map(({ companyCase, mission }) => `${mission.title} · ${companyCase.objective}`)
                    : ["No hay revisiones pendientes."],
                  caseIds: pendingReviews.map(({ companyCase }) => companyCase.requestId),
                })}
                className="cursor-pointer border-white/10 bg-slate-950/80 text-slate-100 transition hover:border-cyan-400/50"
              >
                <CardHeader>
                  <CardDescription>Operación</CardDescription>
                  <CardTitle>
                    {operations.queued} cola · {operations.active} activos
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-slate-400">
                  {operations.reviews} revisiones pendientes
                </CardContent>
              </Card>
              <Card
                role="button"
                tabIndex={0}
                onClick={() => {
                  const latest = allCases
                    .slice()
                    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
                  if (latest) {
                    setSelectedId(latest.requestId);
                    setView("Caso");
                  } else {
                    setDetail({ title: "Último ciclo exitoso", description: "Todavía no hay un caso registrado.", lines: ["Sin registro"] });
                  }
                }}
                className="cursor-pointer border-white/10 bg-slate-950/80 text-slate-100 transition hover:border-cyan-400/50"
              >
                <CardHeader>
                  <CardDescription>Último ciclo exitoso</CardDescription>
                  <CardTitle className="text-base">
                    {formatDate(operations.lastSuccessfulCycle)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-slate-400">
                  Heartbeat: {formatDate(operations.lastHeartbeat)}
                </CardContent>
              </Card>
              <Card
                role="button"
                tabIndex={0}
                onClick={() => setDetail({
                  title: "Auditoría persistida",
                  description: "Resumen de eventos y escrituras detectadas en los casos cargados.",
                  lines: [
                    `Escrituras empresariales: ${audit.businessWrites}`,
                    `Cambios de infraestructura: ${audit.infrastructureWrites}`,
                    `Eventos: ${audit.auditEvents}`,
                    `Cobertura: ${audit.auditCoverageComplete ? "completa" : "incompleta"}`,
                  ],
                })}
                className="cursor-pointer border-white/10 bg-slate-950/80 text-slate-100 transition hover:border-cyan-400/50"
              >
                <CardHeader>
                  <CardDescription>Auditoría persistida</CardDescription>
                  <CardTitle>
                    {audit.businessWrites} escrituras empresariales
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-slate-400">
                  {audit.infrastructureWrites} cambios de infraestructura ·{" "}
                  {audit.auditEvents} eventos ·{" "}
                  {audit.auditCoverageComplete
                    ? "cobertura completa"
                    : "cobertura incompleta"}
                </CardContent>
              </Card>
            </div>
            <Card className="border-white/10 bg-slate-950/80 text-slate-100">
              <CardHeader>
                <CardTitle>Prioridades ejecutivas</CardTitle>
                <CardDescription className="text-slate-400">
                  Riesgos, gaps, decisiones y costo; IDs y telemetría quedan en
                  las vistas técnicas.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">
                {latestRisks.length ? (
                  latestRisks.map((risk) => (
                    <button
                      key={risk.riskId}
                      type="button"
                      onClick={() => {
                        const source = allCases.find((item) => item.agentId === "systems-manager-ai-v1");
                        if (source) {
                          setSelectedId(source.requestId);
                          setView("Sistemas");
                        }
                      }}
                      className="rounded-xl border border-white/10 p-4"
                    >
                      <Badge variant="outline">
                        {risk.classification === "ACTION_REQUIRED"
                          ? `${priorityBand(risk.priority)} · Score ${risk.priority}`
                          : risk.classification}
                      </Badge>
                      <p className="mt-2 font-semibold">{risk.title}</p>
                      <p className="mt-2 text-sm text-slate-400">
                        {risk.recommendedAction}
                      </p>
                    </button>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">
                    Sin snapshot técnico cargado.
                  </p>
                )}
              </CardContent>
            </Card>
            <div className="grid gap-3 sm:grid-cols-3">
              <Badge variant="outline" className="justify-center p-3">
                <ShieldCheck className="mr-2 h-4 w-4 text-emerald-300" />
                {audit.auditCoverageComplete &&
                audit.businessWrites === 0 &&
                audit.infrastructureWrites === 0
                  ? "Cero escrituras verificadas por auditoría"
                  : "Revisar cobertura de auditoría"}
              </Badge>
              <Badge variant="outline" className="justify-center p-3">
                {totals.tokens.toLocaleString()} tokens
              </Badge>
              <Badge variant="outline" className="justify-center p-3">
                ${totals.cost.toFixed(4)} costo acumulado visible
              </Badge>
            </div>
          </div>
        )}

        {view === "Carga de listas" && agentId === "data-manager-ai-v1" && (
          <Card className="border-cyan-500/20 bg-slate-950/80 text-slate-100">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileSpreadsheet className="text-cyan-300" />
                Ingresar lista de precios
              </CardTitle>
              <CardDescription className="text-slate-400">
                Cargá XLS/XLSX/XLSM/CSV/TXT o pegá el texto recibido del proveedor. Se analiza sin modificar stock, precios ni compras y se envía el caso al Gerente de Datos.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="supplier-name">Proveedor</Label>
                  <Input id="supplier-name" value={supplierName} onChange={(event) => setSupplierName(event.target.value)} placeholder="Nombre del proveedor" className="border-white/10 bg-black/30" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="supplier-file">Archivo</Label>
                  <Input id="supplier-file" type="file" accept=".xls,.xlsx,.xlsm,.csv,.txt" onChange={(event) => setListFile(event.target.files?.[0] ?? null)} className="border-white/10 bg-black/30 file:text-cyan-300" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="supplier-text">Texto de WhatsApp (opcional)</Label>
                <Textarea id="supplier-text" value={listText} onChange={(event) => setListText(event.target.value)} className="min-h-32 border-white/10 bg-black/30" placeholder="iPhone 15 128GB — USD 620..." />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={() => void submitSupplierList()} disabled={busy || (!listFile && !listText.trim())} className="bg-cyan-400 font-bold text-slate-950 hover:bg-cyan-300">
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                  Analizar y enviar a Datos
                </Button>
                {intakeResult && <p className="text-sm text-emerald-300">{intakeResult}</p>}
              </div>
            </CardContent>
          </Card>
        )}

        {view === "Catálogo" && agentId === "data-manager-ai-v1" && (
          <Card className="border-white/10 bg-slate-950/80 text-slate-100">
            <CardHeader>
              <CardTitle>Calidad y actualización de datos</CardTitle>
              <CardDescription className="text-slate-400">El Gerente de Datos concentra las listas cargadas, los casos DATA_ y sus revisiones.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              <button type="button" onClick={() => setView("Carga de listas")} className="rounded-xl border border-white/10 p-4 text-left transition hover:border-cyan-400/50"><p className="font-semibold">Nueva lista</p><p className="mt-1 text-xs text-slate-400">Analizar proveedor</p></button>
              <button type="button" onClick={() => setView("Inbox")} className="rounded-xl border border-white/10 p-4 text-left transition hover:border-cyan-400/50"><p className="font-semibold">Casos de datos</p><p className="mt-1 text-xs text-slate-400">{cases.length} casos en inbox</p></button>
              <button type="button" onClick={() => setDetail({ title: "Cobertura del catálogo", description: "Resumen de la fuente operativa disponible.", lines: [`Casos de datos: ${cases.length}`, `Revisiones de datos: ${pendingReviews.length}`, "Los resultados detallados se abren desde Inbox → Caso."] })} className="rounded-xl border border-white/10 p-4 text-left transition hover:border-cyan-400/50"><p className="font-semibold">Cobertura</p><p className="mt-1 text-xs text-slate-400">Ver estado</p></button>
            </CardContent>
          </Card>
        )}

        {view === "Decisiones" && agentId === "general-manager-ai-v3" && (
          <Card className="border-white/10 bg-slate-950/80 text-slate-100">
            <CardHeader><CardTitle>Prioridades y decisiones ejecutivas</CardTitle><CardDescription className="text-slate-400">Abrí cualquier prioridad para ir al caso y registrar una decisión con motivo.</CardDescription></CardHeader>
            <CardContent className="space-y-2">
              {allCases.flatMap((companyCase) => companyCase.missions.filter((mission) => reviewMissionStatuses.has(mission.status)).map((mission) => ({ companyCase, mission }))).map(({ companyCase, mission }) => (
                <button type="button" key={mission.id} onClick={() => { setSelectedId(companyCase.requestId); setView("Caso"); }} className="w-full rounded-xl border border-white/10 p-3 text-left transition hover:border-cyan-400/50"><p className="font-semibold">{mission.title}</p><p className="text-xs text-slate-400">{companyCase.objective}</p></button>
              ))}
              {!pendingReviews.length && <p className="text-sm text-slate-500">No hay decisiones pendientes.</p>}
            </CardContent>
          </Card>
        )}

        {view === "Inbox" && (
          <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
            <Card className="border-white/10 bg-slate-950/80 text-slate-100">
              <CardHeader>
                <CardTitle>Nueva orden</CardTitle>
                <CardDescription className="text-slate-400">
                  Se persiste antes del webhook y conserva el contrato
                  advisory-only.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea
                  value={objective}
                  onChange={(event) => setObjective(event.target.value)}
                  maxLength={600}
                  className="min-h-24 border-white/10 bg-black/30"
                  placeholder="¿Qué debe analizar el agente?"
                />
                <Input
                  value={relatedRequestId}
                  onChange={(event) => setRelatedRequestId(event.target.value)}
                  className="border-white/10 bg-black/30"
                  placeholder="Caso relacionado (opcional)"
                />
                <Button
                  onClick={() => void createCase()}
                  disabled={busy || !objective.trim()}
                  className="bg-cyan-400 font-bold text-slate-950 hover:bg-cyan-300"
                >
                  {busy ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="mr-2 h-4 w-4" />
                  )}
                  Encolar análisis
                </Button>
              </CardContent>
            </Card>
            <Card className="border-white/10 bg-slate-950/80 text-slate-100">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Inbox</CardTitle>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void refresh()}
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="max-h-[620px] space-y-2 overflow-auto">
                {cases.map((item) => (
                  <button
                    key={item.requestId}
                    onClick={() => {
                      setSelectedId(item.requestId);
                      setView("Caso");
                    }}
                    className={`w-full rounded-xl border p-3 text-left ${selected?.requestId === item.requestId ? "border-cyan-400/50 bg-cyan-500/10" : "border-white/10 bg-white/5"}`}
                  >
                    <div className="flex justify-between gap-2">
                      <Badge
                        variant="outline"
                        className={statusColor[item.status]}
                      >
                        {item.status}
                      </Badge>
                      <span className="text-[10px] text-slate-500">
                        {new Date(item.createdAt).toLocaleString("es-AR")}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm">
                      {item.objective}
                    </p>
                  </button>
                ))}
              </CardContent>
            </Card>
          </div>
        )}

        {view === "Caso" &&
          (selected ? (
            <div className="space-y-5">
              <Card className="border-white/10 bg-slate-950/80 text-slate-100">
                <CardHeader>
                  <div className="flex justify-between gap-3">
                    <CardTitle>Caso seleccionado</CardTitle>
                    <Badge
                      variant="outline"
                      className={statusColor[selected.status]}
                    >
                      {selected.status}
                    </Badge>
                  </div>
                  <CardDescription className="text-slate-500">
                    Creado{" "}
                    {new Date(selected.createdAt).toLocaleString("es-AR")} ·
                    webhook {selected.webhookDeliveryStatus}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {selected.messages.map((message) => {
                    const parsed =
                      message.kind === "RESULT"
                        ? resultContent(message.content)
                        : null;
                    return (
                      <div
                        key={message.id}
                        className="rounded-xl border border-white/10 bg-white/5 p-4"
                      >
                        <div className="mb-2 flex justify-between text-[10px] uppercase text-slate-500">
                          <span>
                            {message.role} · {message.kind}
                          </span>
                          <span>
                            {new Date(message.createdAt).toLocaleString(
                              "es-AR",
                            )}
                          </span>
                        </div>
                        {parsed ? (
                          <div className="space-y-2 text-sm">
                            <p>{parsed.summary}</p>
                            {parsed.primaryConfirmedRisk && (
                              <>
                                <p>
                                  <b className="text-red-300">Riesgo:</b>{" "}
                                  {parsed.primaryConfirmedRisk}
                                </p>
                                <p>
                                  <b className="text-amber-300">Gap:</b>{" "}
                                  {parsed.primaryCoverageGap}
                                </p>
                              </>
                            )}
                            <p className="text-xs text-slate-500">
                              Evidencia: {parsed.evidenceRefs?.join(", ")}
                            </p>
                          </div>
                        ) : (
                          <p className="whitespace-pre-wrap text-sm">
                            {message.content}
                          </p>
                        )}
                      </div>
                    );
                  })}
                  <div className="flex gap-2">
                    <Textarea
                      value={context}
                      onChange={(event) => setContext(event.target.value)}
                      maxLength={4000}
                      className="border-white/10 bg-black/30"
                      placeholder="Contexto adicional append-only"
                    />
                    <Button
                      onClick={() => void appendContext()}
                      disabled={busy || !context.trim()}
                    >
                      <MessageSquarePlus className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setRelatedRequestId(selected.requestId);
                        setView("Inbox");
                      }}
                    >
                      <GitBranch className="mr-2 h-4 w-4" />
                      Crear caso relacionado
                    </Button>
                    {!["FAILED", "CANCELLED", "COMPLETED"].includes(
                      selected.status,
                    ) && (
                      <Button
                        variant="outline"
                        onClick={() =>
                          void post(
                            `/api/company-os/v3/cases/${selected.requestId}/cancel`,
                            { reason: "Cancelado desde Company OS" },
                          )
                        }
                        disabled={busy}
                        className="border-red-500/30 text-red-300"
                      >
                        <Ban className="mr-2 h-4 w-4" />
                        Cancelar
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
              {selected.missions.length > 0 && (
                <Card className="border-white/10 bg-slate-950/80 text-slate-100">
                  <CardHeader>
                    <CardTitle>Decisiones pendientes</CardTitle>
                    <CardDescription className="text-amber-300">
                      Aprobar valida el análisis; ninguna acción ejecuta
                      infraestructura.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {selected.missions.map((mission) => {
                      const terminal = [
                        "APPROVED",
                        "REJECTED",
                        "BLOCKED",
                      ].includes(mission.status);
                      return (
                        <div
                          key={mission.id}
                          className="rounded-xl border border-white/10 p-4"
                        >
                          <div className="flex justify-between gap-3">
                            <p className="font-bold">{mission.title}</p>
                            <Badge variant="outline">{mission.status}</Badge>
                          </div>
                          <p className="mt-2 text-sm text-slate-400">
                            {mission.expectedOutput}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              disabled={terminal}
                              onClick={() =>
                                void decideMission(mission.id, "APPROVE")
                              }
                            >
                              Aprobar
                            </Button>
                            {[
                              ["REQUEST_REVIEW", "Revisar"],
                              ["REJECT", "Rechazar"],
                              ["EDIT", "Editar"],
                              ["POSTPONE", "Posponer"],
                              ["MARK_INCORRECT", "Información incorrecta"],
                              ["BLOCK", "Bloquear"],
                            ].map(([decision, label]) => (
                              <Button
                                key={decision}
                                size="sm"
                                variant="outline"
                                disabled={terminal}
                                onClick={() => openMission(mission, decision)}
                              >
                                {label}
                              </Button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              )}
              <details className="rounded-2xl border border-white/10 bg-slate-950/80 p-4">
                <summary className="cursor-pointer font-semibold text-violet-200">
                  Detalles técnicos del caso
                </summary>
                <div className="mt-4 space-y-4">
                  <div className="flex flex-wrap gap-2">
                    {selected.events.map((event) => (
                      <Badge key={event.id} variant="outline">
                        #{event.sequence} {event.eventType}
                      </Badge>
                    ))}
                  </div>
                  {selected.usage.map((usage, index) => (
                    <div
                      key={index}
                      className="grid gap-2 rounded-xl border border-white/10 p-3 text-sm sm:grid-cols-3"
                    >
                      <span>Total: {usage.totalTokens}</span>
                      <span>
                        Costo: ${Number(usage.estimatedCostUsd).toFixed(6)}
                      </span>
                      <span>Duración: {usage.durationMs ?? 0} ms</span>
                      <span>Reintentos: {usage.retries ?? 0}</span>
                      <span>Snapshot: {usage.snapshotBytes ?? 0} bytes</span>
                      <span>
                        Heartbeat: {formatDate(operations.lastHeartbeat)}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          ) : (
            <Card className="border-white/10 bg-slate-950/80 text-slate-100">
              <CardContent className="flex min-h-64 items-center justify-center text-slate-500">
                <CheckCircle2 className="mr-2 h-5 w-5" />
                No hay casos todavía
              </CardContent>
            </Card>
          ))}

        {view === "Sistemas" &&
          selected?.agentId === "systems-manager-ai-v1" && (
            <SystemsEvidence companyCase={selected} onRiskAction={openRisk} />
          )}
        {agentId === "general-manager-ai-v3" &&
          view === "Resumen" &&
          reports.length > 0 && (
            <Card className="border-violet-500/20 bg-slate-950/80 text-slate-100">
              <CardHeader>
                <CardTitle>Handoff del Gerente de Sistemas</CardTitle>
              </CardHeader>
              <CardContent>
                {reports.slice(0, 10).map((report) => (
                  <button
                    key={report.requestId}
                    type="button"
                    onClick={() => { setSelectedId(report.requestId); setView("Caso"); }}
                    className="block w-full border-b border-white/10 py-2 text-left text-sm transition hover:text-cyan-200"
                  >
                    {report.objective}
                  </button>
                ))}
              </CardContent>
            </Card>
          )}
      </div>
      <Dialog
        open={Boolean(detail)}
        onOpenChange={(open) => !open && setDetail(null)}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto border-white/10 bg-slate-950 text-slate-100">
          <DialogHeader>
            <DialogTitle>{detail?.title}</DialogTitle>
            <DialogDescription className="text-slate-400">{detail?.description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {detail?.lines.map((line, index) => <p key={`${line}-${index}`} className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm">{line}</p>)}
            {detail?.caseIds && detail.caseIds.length > 0 && (
              <div className="border-t border-white/10 pt-3">
                <p className="mb-2 text-xs uppercase text-slate-500">Abrir caso</p>
                {detail.caseIds.map((requestId) => {
                  const companyCase = allCases.find((item) => item.requestId === requestId);
                  if (!companyCase) return null;
                  return <button type="button" key={requestId} onClick={() => { setSelectedId(requestId); setView("Caso"); setDetail(null); }} className="mb-2 w-full rounded-lg border border-cyan-500/30 p-2 text-left text-xs text-cyan-200 transition hover:bg-cyan-500/10">{companyCase.objective}</button>;
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(action)}
        onOpenChange={(open) => !open && setAction(null)}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto border-white/10 bg-slate-950 text-slate-100">
          <DialogHeader>
            <DialogTitle>{action?.title}</DialogTitle>
            <DialogDescription className="text-slate-400">
              El motivo es obligatorio y quedará registrado en el historial
              append-only.
            </DialogDescription>
          </DialogHeader>
          {action?.decision === "EDIT" && (
            <div className="space-y-2">
              <Label htmlFor="edit-title">Título</Label>
              <Input
                id="edit-title"
                value={action.editTitle}
                onChange={(event) =>
                  setAction({ ...action, editTitle: event.target.value })
                }
              />
              <Label htmlFor="edit-output">Entregable</Label>
              <Textarea
                id="edit-output"
                value={action.editOutput}
                onChange={(event) =>
                  setAction({ ...action, editOutput: event.target.value })
                }
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="decision-reason">Motivo obligatorio</Label>
            <Textarea
              id="decision-reason"
              required
              value={action?.reason ?? ""}
              onChange={(event) =>
                action && setAction({ ...action, reason: event.target.value })
              }
            />
          </div>
          {action?.decision === "POSTPONE" && (
            <div className="space-y-2">
              <Label htmlFor="defer-until">Revisar nuevamente</Label>
              <Input
                id="defer-until"
                type="datetime-local"
                required
                value={action.deferUntil}
                onChange={(event) =>
                  setAction({ ...action, deferUntil: event.target.value })
                }
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAction(null)}>
              Cancelar
            </Button>
            <Button
              disabled={busy || !actionValid}
              onClick={() => void submitAction()}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Registrar decisión
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
