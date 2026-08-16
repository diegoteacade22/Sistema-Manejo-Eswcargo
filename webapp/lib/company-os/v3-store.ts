import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type CompanyOsCase } from '@prisma/client';
import { buildCompanySnapshot } from './live-snapshot';
import { sanitizeCompanyObjective, sanitizeCompanyText } from './objective';
import { buildSystemsSnapshot } from './systems-snapshot';
import { signCompanyOsWorkerPayload } from './v3-auth';
import { companyOsV3Prisma } from './v3-prisma';
import {
  COMPANY_OS_MISSION_STATUSES,
  COMPANY_OS_REQUEST_STATUSES,
  COMPANY_OS_AGENT_CONTRACTS,
  COMPANY_OS_AGENT_IDS,
  COMPANY_OS_V3_IDENTITY,
  companyOsDailyTokenLimit,
  companyOsV3BudgetConfig,
  type CompanyOsAgentId,
  type CompanyOsSystemsWorkerResult,
  type CompanyOsMissionStatus,
  type CompanyOsRequestStatus,
  type CompanyOsWorkerResult,
  type CompanyOsWorkerUsage,
} from './v3-types';

const LEASE_MS = 4 * 60 * 1000;
const WORKER_REF = 'hostinger-company-os-v3';
const GLOBAL_LOCK_ID = '__COMPANY_OS_V3_GLOBAL__';
const TERMINAL_REQUEST_STATUSES = new Set<CompanyOsRequestStatus>(['FAILED', 'CANCELLED', 'COMPLETED']);

type Tx = Prisma.TransactionClient;
type Identity = { authMode: string; actorRef: string };

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function redactResult(value: unknown): unknown {
  if (typeof value === 'string') return sanitizeCompanyText(value, 4000).safeText;
  if (Array.isArray(value)) return value.map(redactResult);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, redactResult(nested)]));
  return value;
}

function estimateTokens(value: unknown) {
  return Math.ceil(Buffer.byteLength(JSON.stringify(value), 'utf8') / 4);
}

function materializeSnapshot(snapshot: Awaited<ReturnType<typeof buildCompanySnapshot>>, inputBudget: number) {
  const critical = {
    snapshotId: snapshot.snapshotId,
    generatedAt: snapshot.generatedAt,
    businessDate: snapshot.businessDate,
    source: snapshot.source,
    metrics: snapshot.metrics,
    quality: snapshot.quality,
    freshness: snapshot.freshness,
    distributions: snapshot.distributions,
  };
  const full = { ...critical, calibration: snapshot.calibration };
  if (estimateTokens(full) <= inputBudget) return { payload: full, selected: false, blocked: false };

  const selected = {
    ...critical,
    calibration: {
      actionableProducts: snapshot.calibration.actionableProducts.slice(0, 25),
      delayedShipmentDossiers: snapshot.calibration.delayedShipmentDossiers.slice(0, 25),
      selectionNotice: 'Evidence was deterministically selected to fit the input budget; critical metrics, gaps and freshness were retained.',
    },
  };
  return { payload: selected, selected: true, blocked: estimateTokens(selected) > inputBudget };
}

function materializeSystemsSnapshot(snapshot: Awaited<ReturnType<typeof buildSystemsSnapshot>>, inputBudget: number) {
  const { assets, dependencies, risks, ...metadata } = snapshot;
  const payload = { metadata, assets, dependencies, risks };
  if (estimateTokens(payload) <= inputBudget) return { payload, selected: false, blocked: false };
  const selected = {
    metadata,
    assets: assets.filter((item) => item.criticality === 'CRITICAL' || item.coverageStatus !== 'CONFIRMED'),
    dependencies: dependencies.filter((item) => item.criticality === 'CRITICAL'),
    risks,
  };
  return { payload: selected, selected: true, blocked: estimateTokens(selected) > inputBudget };
}

async function appendCaseEvent(tx: Tx, input: {
  caseId: string;
  requestId: string;
  eventType: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  payload?: Record<string, unknown>;
  idempotencyKey: string;
}) {
  const existing = await tx.companyOsCaseEvent.findUnique({
    where: { caseId_idempotencyKey: { caseId: input.caseId, idempotencyKey: input.idempotencyKey } },
  });
  if (existing) return existing;
  const previous = await tx.companyOsCaseEvent.findFirst({ where: { caseId: input.caseId }, orderBy: { sequence: 'desc' } });
  const sequence = (previous?.sequence ?? 0) + 1;
  const payload = input.payload ?? {};
  const eventHash = hash(JSON.stringify({
    requestId: input.requestId,
    sequence,
    eventType: input.eventType,
    fromStatus: input.fromStatus ?? null,
    toStatus: input.toStatus ?? null,
    payload,
    previousHash: previous?.eventHash ?? null,
  }));
  return tx.companyOsCaseEvent.create({ data: {
    caseId: input.caseId,
    sequence,
    eventType: input.eventType,
    fromStatus: input.fromStatus ?? null,
    toStatus: input.toStatus ?? null,
    payload: jsonValue(payload),
    idempotencyKey: input.idempotencyKey,
    previousHash: previous?.eventHash ?? null,
    eventHash,
  } });
}

function environmentForDatabase(value: string) {
  const normalized = value.toUpperCase();
  return ['PRODUCTION','PREVIEW','STAGING','DEVELOPMENT','LOCAL','UNKNOWN'].includes(normalized) ? normalized : 'UNKNOWN';
}

function priorityBand(score: number) {
  if (score >= 90) return 'P0';
  if (score >= 75) return 'P1';
  if (score >= 50) return 'P2';
  if (score >= 25) return 'P3';
  return 'P4';
}

async function persistSystemsSnapshot(
  tx: Tx,
  companyCase: { id: string; requestId: string; caseType: string },
  snapshot: Awaited<ReturnType<typeof buildSystemsSnapshot>>,
) {
  const refs = await tx.companyOsEvidenceRef.findMany({ where: { caseId: companyCase.id }, select: { id: true, evidenceKey: true } });
  const refByKey = new Map(refs.map((ref) => [ref.evidenceKey, ref.id]));
  const evidenceId = refByKey.get('metadata');
  const assetEvidenceId = refByKey.get('assets');
  const dependencyEvidenceId = refByKey.get('dependencies');
  const riskEvidenceId = refByKey.get('risks');
  if (!evidenceId || !assetEvidenceId || !dependencyEvidenceId || !riskEvidenceId) throw new Error('Evidencia técnica incompleta');
  const snapshotRecordId = `systems-snapshot:${companyCase.id}`;
  const inventoryHash = hash(JSON.stringify({ assets: snapshot.assets, dependencies: snapshot.dependencies, risks: snapshot.risks }));
  const scope = companyCase.caseType === 'SYSTEMS_BASELINE' ? 'DAILY' : companyCase.caseType === 'SYSTEMS_DEEP_REVIEW' ? 'WEEKLY' : 'ON_DEMAND';
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO public."CompanyOsSystemSnapshot"
      (id, "caseId", "agentId", "snapshotKey", scope, status, "schemaVersion", "inventoryHash", "evidenceId",
       "observedAt", "completedAt", "assetCount", "dependencyCount", "healthCheckCount", "riskCount",
       "qualityScore", "coverageScore", "idempotencyKey")
    VALUES
      (${snapshotRecordId}, ${companyCase.id}, 'systems-manager-ai-v1', ${companyCase.requestId}, ${scope},
       'COMPLETE', 1, ${inventoryHash}, ${evidenceId}, ${new Date(snapshot.generatedAt)}, ${new Date(snapshot.generatedAt)},
       ${snapshot.assets.length}, ${snapshot.dependencies.length}, ${snapshot.assets.length}, ${snapshot.risks.length},
       95, 33.33, ${`systems-snapshot:${companyCase.requestId}`})
  `);
  for (const asset of snapshot.assets) {
    const assetRecordId = `systems-asset:${companyCase.id}:${asset.assetId}`;
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO public."CompanyOsSystemAsset"
        (id, "snapshotId", "caseId", "assetKey", name, category, provider, environment, "lifecycleStatus",
         "healthStatus", criticality, "ownerRef", region, version, "safeLocator", "safeAttributes", "evidenceId",
         "observedAt", "idempotencyKey")
      VALUES
        (${assetRecordId}, ${snapshotRecordId}, ${companyCase.id}, ${asset.assetId}, ${asset.name}, ${asset.category},
         ${asset.provider}, ${environmentForDatabase(asset.environment)}, ${asset.lifecycleStatus}, ${asset.healthStatus},
         ${asset.criticality}, ${asset.owner}, ${asset.region}, ${asset.runtime}, ${asset.safeReference},
         ${jsonValue(asset)}, ${assetEvidenceId}, ${new Date(asset.observedAt)}, ${`systems-asset:${companyCase.requestId}:${asset.assetId}`})
    `);
    const healthStatus = asset.healthStatus === 'HEALTHY' ? 'PASS'
      : asset.healthStatus === 'DEGRADED' ? 'WARN'
        : asset.healthStatus === 'OFFLINE_CONFIRMED' ? 'FAIL'
          : asset.healthStatus === 'UNOBSERVED' ? 'UNOBSERVED' : 'UNKNOWN';
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO public."CompanyOsSystemHealthObservation"
        (id, "snapshotId", "caseId", "assetKey", "checkKey", status, "signalType", summary, "qualityScore",
         "evidenceId", "observedAt", "idempotencyKey")
      VALUES
        (${`systems-health:${companyCase.id}:${asset.assetId}`}, ${snapshotRecordId}, ${companyCase.id}, ${asset.assetId},
         'snapshot-health', ${healthStatus}, 'AVAILABILITY', ${asset.warnings[0] ?? asset.healthStatus},
         ${Math.round(asset.confidence * 100)}, ${assetEvidenceId}, ${new Date(asset.observedAt)},
         ${`systems-health:${companyCase.requestId}:${asset.assetId}`})
    `);
  }
  for (const dependency of snapshot.dependencies) {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO public."CompanyOsSystemDependency"
        (id, "snapshotId", "caseId", "dependencyKey", "fromAssetKey", "toAssetKey", "dependencyType",
         criticality, status, direction, "evidenceId", "observedAt", "idempotencyKey")
      VALUES
        (${`systems-dependency:${companyCase.id}:${dependency.dependencyId}`}, ${snapshotRecordId}, ${companyCase.id},
         ${dependency.dependencyId}, ${dependency.sourceAssetId}, ${dependency.targetAssetId}, ${dependency.dependencyType},
         ${dependency.criticality}, ${dependency.inferenceStatus}, ${dependency.direction}, ${dependencyEvidenceId},
         ${new Date(dependency.observedAt)}, ${`systems-dependency:${companyCase.requestId}:${dependency.dependencyId}`})
    `);
  }
  const observedSources = snapshot.coverage.observed;
  const unobservedSources = snapshot.coverage.unobserved;
  for (const [index, source] of [...observedSources, ...unobservedSources].entries()) {
    const observed = index < observedSources.length;
    const sourceKey = source.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO public."CompanyOsSystemCoverageObservation"
        (id, "snapshotId", "caseId", "sourceKey", "sourceType", status, "expectedSignals", "observedSignals",
         "qualityScore", "gapReason", "evidenceId", "observedAt", "idempotencyKey")
      VALUES
        (${`systems-coverage:${companyCase.id}:${sourceKey}`}, ${snapshotRecordId}, ${companyCase.id}, ${sourceKey},
         'OTHER', ${observed ? 'OBSERVED' : 'UNOBSERVED'}, 1, ${observed ? 1 : 0}, ${observed ? 100 : 0},
         ${observed ? null : 'Fuente no conectada; no se interpreta como falla del sistema'}, ${evidenceId},
         ${new Date(snapshot.generatedAt)}, ${`systems-coverage:${companyCase.requestId}:${sourceKey}`})
    `);
  }
  for (const risk of snapshot.risks) {
    const score = risk.classification === 'ACTION_REQUIRED' ? risk.priority : 0;
    const riskRecordId = `systems-risk:${companyCase.id}:${risk.riskId}`;
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO public."CompanyOsSystemRisk"
        (id, "snapshotId", "caseId", "riskKey", "assetKey", classification, severity, likelihood, status,
         title, finding, impact, "nextStep", score, priority, confidence, cause, hypothesis,
         "affectedDependencies", "recommendedAction", effort, "changeRisk", rollback, owner, "targetDate",
         "missingEvidence", "reasonCodes", "evidenceFingerprint", "ruleVersion", confirmed, "coverageGap",
         "qualityScore", "evidenceId", "observedAt", "idempotencyKey")
      VALUES
        (${riskRecordId}, ${snapshotRecordId}, ${companyCase.id}, ${risk.riskId}, ${risk.assetId},
         ${risk.classification}, ${score >= 75 ? 'HIGH' : risk.classification === 'REVIEW' ? 'MEDIUM' : 'INFO'},
         ${risk.classification === 'ACTION_REQUIRED' ? 'LIKELY' : 'UNKNOWN'}, 'OPEN', ${risk.title}, ${risk.description},
         ${risk.impact}, ${risk.recommendedAction}, ${score}, ${priorityBand(score)}, ${risk.confidence},
         ${risk.cause}, ${risk.classification === 'REVIEW' ? risk.cause : ''}, ${risk.affectedDependencies},
         ${risk.recommendedAction}, ${risk.estimatedEffort === 'LOW' ? 'S' : risk.estimatedEffort === 'MEDIUM' ? 'M' : 'UNKNOWN'},
         ${risk.changeRisk}, ${risk.suggestedRollback}, ${risk.proposedOwner}, ${risk.suggestedTargetDate},
         ${risk.missingEvidence}, ${risk.reasonCodes}, ${risk.evidenceFingerprint}, ${risk.ruleVersion},
         ${risk.classification === 'ACTION_REQUIRED'}, ${risk.classification === 'REVIEW'}, ${Math.round(risk.confidence * 100)},
         ${riskEvidenceId}, ${new Date(snapshot.generatedAt)}, ${`systems-risk:${companyCase.requestId}:${risk.riskId}`})
    `);
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO public."CompanyOsSystemRiskHistory"
        (id, "riskId", "snapshotId", "caseId", "eventType", "fromStatus", "toStatus", "actorRef", rationale,
         "evidenceId", "idempotencyKey")
      VALUES
        (${`systems-risk-history:${companyCase.id}:${risk.riskId}`}, ${riskRecordId}, ${snapshotRecordId},
         ${companyCase.id}, 'DETECTED', NULL, 'OPEN', 'systems-manager-ai-v1', ${risk.description},
         ${riskEvidenceId}, ${`systems-risk-history:${companyCase.requestId}:${risk.riskId}`})
    `);
  }
}

export async function createCompanyOsCase(
  rawObjective: string,
  identity: Identity,
  relatedRequestId?: string,
  agentId: CompanyOsAgentId = COMPANY_OS_V3_IDENTITY,
  caseType = 'ADVISORY',
  scheduleRunKey?: string,
) {
  if (rawObjective.trim().length > 600) throw new Error('La orden supera 600 caracteres y no será truncada silenciosamente');
  const sanitized = sanitizeCompanyObjective(rawObjective);
  const budgets = companyOsV3BudgetConfig();
  if (!sanitized.safeObjective) throw new Error('La orden no puede quedar vacía');
  if (!COMPANY_OS_AGENT_IDS.includes(agentId)) throw new Error('Agente Company OS inválido');
  if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(caseType)) throw new Error('caseType inválido');
  const systemsManager = agentId === 'systems-manager-ai-v1';
  const contract = COMPANY_OS_AGENT_CONTRACTS[agentId];
  const snapshot = systemsManager ? await buildSystemsSnapshot() : await buildCompanySnapshot();
  const evidence = systemsManager
    ? materializeSystemsSnapshot(snapshot as Awaited<ReturnType<typeof buildSystemsSnapshot>>, budgets.inputBudget)
    : materializeSnapshot(snapshot as Awaited<ReturnType<typeof buildCompanySnapshot>>, budgets.inputBudget);
  const inputBudgetEstimate = estimateTokens({ objective: sanitized.safeObjective, evidence: evidence.payload }) + 300;
  const blocked = evidence.blocked || inputBudgetEstimate > budgets.inputBudget;
  const requestId = randomUUID();
  const db = companyOsV3Prisma();

  const created = await db.$transaction(async (tx) => {
    const relatedCase = relatedRequestId
      ? await tx.companyOsCase.findUnique({ where: { requestId: relatedRequestId }, select: { id: true } })
      : null;
    if (relatedRequestId && !relatedCase) throw new Error('El caso relacionado no existe');
    const companyCase = await tx.companyOsCase.create({ data: {
      requestId,
      agentId,
      area: contract.area,
      caseType,
      scheduleRunKey,
      objective: sanitized.safeObjective,
      objectiveHash: sanitized.objectiveHash,
      status: blocked ? 'BLOCKED' : 'QUEUED',
      actorRef: identity.actorRef,
      authMode: identity.authMode,
      relatedCaseId: relatedCase?.id,
      inputBudgetEstimate,
      maxOutputTokens: budgets.maxOutputTokens,
      targetTotalTokens: budgets.targetTotalTokens,
      webhookDeliveryStatus: blocked ? 'FAILED' : 'PENDING',
    } });
    await tx.companyOsMessage.create({ data: {
      caseId: companyCase.id, role: 'USER', kind: 'ORDER', content: sanitized.safeObjective, actorRef: identity.actorRef,
    } });
    const refs = Object.entries(evidence.payload).map(([evidenceKey, value]) => ({
      caseId: companyCase.id,
      evidenceKey,
      sourceRef: `company-os-snapshot:${snapshot.snapshotId}#${evidenceKey}`,
      value: jsonValue(value),
      critical: systemsManager ? ['assets','dependencies','risks'].includes(evidenceKey) : ['metrics', 'quality', 'freshness'].includes(evidenceKey),
      observedAt: new Date(snapshot.generatedAt),
    }));
    await tx.companyOsEvidenceRef.createMany({ data: refs });
    if (systemsManager) {
      await persistSystemsSnapshot(
        tx,
        { id: companyCase.id, requestId, caseType },
        snapshot as Awaited<ReturnType<typeof buildSystemsSnapshot>>,
      );
    }
    await appendCaseEvent(tx, {
      caseId: companyCase.id, requestId, eventType: blocked ? 'CASE_BLOCKED_INPUT_BUDGET' : 'CASE_QUEUED', toStatus: blocked ? 'BLOCKED' : 'QUEUED',
      payload: { snapshotId: snapshot.snapshotId, inputBudgetEstimate, inputBudget: budgets.inputBudget, evidenceSelected: evidence.selected, redactions: sanitized.redactions },
      idempotencyKey: `case:${requestId}:${blocked ? 'blocked' : 'queued'}`,
    });
    await tx.companyOsAuditEvent.create({ data: {
      requestId, action: 'CASE_CREATED', actorRef: identity.actorRef,
      metadata: jsonValue({ businessWrites: 0, infrastructureWrites: 0, identity: agentId, reportsToAgentId: contract.reportsToAgentId }),
      idempotencyKey: `audit:${requestId}:created`,
    } });
    return companyCase;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  return { ...created, redactions: sanitized.redactions };
}

export async function dispatchCompanyOsWebhook(companyCase: Pick<CompanyOsCase, 'id' | 'requestId' | 'agentId'>) {
  const db = companyOsV3Prisma();
  const baseUrl = (process.env.COMPANY_OS_V3_WORKER_URL ?? '').trim().replace(/\/$/, '');
  const body = JSON.stringify({ requestId: companyCase.requestId });
  let status: 'DELIVERED' | 'FAILED' = 'FAILED';
  let responseCode: number | null = null;
  let errorDetail: string | null = null;
  try {
    if (!baseUrl) throw new Error('COMPANY_OS_V3_WORKER_URL no configurada');
    const signed = signCompanyOsWorkerPayload(body);
    const response = await fetch(`${baseUrl}/webhook`, {
      method: 'POST', body, signal: AbortSignal.timeout(10_000),
      headers: {
        'content-type': 'application/json',
        'x-company-os-timestamp': signed.timestamp,
        'x-company-os-signature': signed.signature,
      },
    });
    responseCode = response.status;
    if (!response.ok) throw new Error(`Webhook HTTP ${response.status}`);
    status = 'DELIVERED';
  } catch (error) {
    errorDetail = (error instanceof Error ? error.message : 'unknown').slice(0, 500);
  }
  await db.$transaction(async (tx) => {
    await tx.companyOsNotificationDelivery.create({ data: {
      caseId: companyCase.id, requestId: companyCase.requestId, agentId: companyCase.agentId, channel: 'WEBHOOK', eventType: 'CASE_QUEUED',
      status, attempt: 1, responseCode, errorDetail, idempotencyKey: `webhook:${companyCase.requestId}:1`,
    } });
    await tx.companyOsCase.update({ where: { id: companyCase.id }, data: { webhookDeliveryStatus: status } });
    await appendCaseEvent(tx, {
      caseId: companyCase.id, requestId: companyCase.requestId,
      eventType: status === 'DELIVERED' ? 'WEBHOOK_DELIVERED' : 'WEBHOOK_DELIVERY_FAILED',
      payload: { responseCode, errorDetail, recoverable: true }, idempotencyKey: `case:${companyCase.requestId}:webhook:1`,
    });
  });
  return { status, responseCode, errorDetail };
}

type DueSchedule = { id: string; agentId: string; scheduleKey: string; cadence: string; caseType: string; timeZone: string };

function dateInTimeZone(timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export async function runDueCompanyOsSchedules() {
  const db = companyOsV3Prisma();
  const due = await db.$queryRaw<DueSchedule[]>(Prisma.sql`
    SELECT id, "agentId", "scheduleKey", cadence, "caseType", "timeZone"
    FROM public."CompanyOsAgentSchedule"
    WHERE enabled = true AND "nextRunAt" <= now()
    ORDER BY "nextRunAt" ASC
    LIMIT 10
  `);
  const results = [];
  for (const schedule of due) {
    if (!COMPANY_OS_AGENT_IDS.includes(schedule.agentId as CompanyOsAgentId)) continue;
    const runDate = dateInTimeZone(schedule.timeZone);
    const scheduleRunKey = `${schedule.agentId}:${schedule.cadence}:${runDate}`;
    let companyCase: CompanyOsCase;
    let reused = false;
    try {
      companyCase = await createCompanyOsCase(
        'Actualizá determinísticamente el inventario técnico, la salud, la cobertura y los riesgos observables. No ejecutes cambios ni reveles secretos.',
        { authMode: 'hmac-worker-schedule', actorRef: WORKER_REF },
        undefined,
        schedule.agentId as CompanyOsAgentId,
        schedule.caseType,
        scheduleRunKey,
      );
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      companyCase = await db.companyOsCase.findUniqueOrThrow({ where: { scheduleRunKey } });
      reused = true;
    }
    const delivery = reused ? null : await dispatchCompanyOsWebhook(companyCase);
    await db.$executeRaw(Prisma.sql`
      UPDATE public."CompanyOsAgentSchedule"
      SET "lastRunAt" = now(),
          "nextRunAt" = CASE
            WHEN cadence = 'DAILY' THEN ((((now() AT TIME ZONE "timeZone")::date + 1) + "localTime") AT TIME ZONE "timeZone")
            ELSE ((((now() AT TIME ZONE "timeZone")::date + 7) + "localTime") AT TIME ZONE "timeZone")
          END,
          "updatedAt" = now()
      WHERE id = ${schedule.id}
    `);
    results.push({ scheduleId: schedule.id, requestId: companyCase.requestId, reused, delivery });
  }
  return results;
}

type ClaimedRow = { id: string; requestId: string; agentId: string; objective: string; status: string; webhookDeliveryStatus: string; maxOutputTokens: number; targetTotalTokens: number };

export async function claimCompanyOsCase(requestId?: string) {
  const db = companyOsV3Prisma();
  return db.$transaction(async (tx) => {
    const requested = requestId?.trim() || null;
    const globalLock = await tx.companyOsLock.findUnique({ where: { requestId: GLOBAL_LOCK_ID } });
    if (globalLock && globalLock.expiresAt > new Date()) return null;
    const rows = await tx.$queryRaw<ClaimedRow[]>(Prisma.sql`
      SELECT c.id, c."requestId", c."agentId", c.objective, c.status, c."webhookDeliveryStatus", c."maxOutputTokens", c."targetTotalTokens"
      FROM public."CompanyOsCase" c
      WHERE (${requested}::text IS NULL OR c."requestId" = ${requested})
        AND (
          c.status = 'QUEUED'
          OR (c.status = 'ANALYZING' AND NOT EXISTS (
            SELECT 1 FROM public."CompanyOsLease" l
            WHERE l."caseId" = c.id AND l.status = 'ACTIVE' AND l."expiresAt" > now()
          ))
          OR (c.status = 'FAILED' AND (
            SELECT count(*) FROM public."CompanyOsExecutionAttempt" a
            WHERE a."caseId" = c.id
          ) < 2)
        )
      ORDER BY c."createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);
    const companyCase = rows[0];
    if (!companyCase) return null;

    const evidence = await tx.companyOsEvidenceRef.findMany({ where: { caseId: companyCase.id }, orderBy: { evidenceKey: 'asc' } });
    const contextMessages = await tx.companyOsMessage.findMany({ where: { caseId: companyCase.id, kind: 'CONTEXT' }, orderBy: { createdAt: 'asc' }, select: { content: true, createdAt: true } });
    const evidencePayload = Object.fromEntries(evidence.map((entry) => [entry.evidenceKey, entry.value]));
    const inputEstimate = estimateTokens({ objective: companyCase.objective, evidencePayload, contextMessages }) + 300;
    const inputBudget = companyCase.targetTotalTokens - companyCase.maxOutputTokens;
    if (inputEstimate > inputBudget) {
      await tx.companyOsCase.update({ where: { id: companyCase.id }, data: { status: 'BLOCKED' } });
      await appendCaseEvent(tx, { caseId: companyCase.id, requestId: companyCase.requestId, eventType: 'CASE_BLOCKED_INPUT_BUDGET', fromStatus: companyCase.status, toStatus: 'BLOCKED', payload: { inputEstimate, inputBudget }, idempotencyKey: `case:${companyCase.requestId}:blocked:context-budget` });
      return null;
    }
    const dailyStart = startOfCompanyOsDay();
    const dailyUsage = await tx.companyOsUsage.aggregate({
      where: { createdAt: { gte: dailyStart }, case: { agentId: companyCase.agentId } }, _sum: { totalTokens: true },
    });
    const dailyUsed = dailyUsage._sum.totalTokens ?? 0;
    const dailyLimit = companyOsDailyTokenLimit(companyCase.agentId as CompanyOsAgentId);
    if (dailyUsed + companyCase.targetTotalTokens > dailyLimit) {
      await tx.companyOsCase.update({ where: { id: companyCase.id }, data: { status: 'BLOCKED' } });
      await appendCaseEvent(tx, {
        caseId: companyCase.id, requestId: companyCase.requestId, eventType: 'CASE_BLOCKED_DAILY_BUDGET',
        fromStatus: companyCase.status, toStatus: 'BLOCKED', payload: { dailyUsed, dailyLimit, reservedTokens: companyCase.targetTotalTokens },
        idempotencyKey: `case:${companyCase.requestId}:blocked:daily-budget`,
      });
      return null;
    }

    const now = new Date();
    const leaseToken = randomUUID();
    const expiresAt = new Date(now.getTime() + LEASE_MS);
    const expiredLeases = await tx.companyOsLease.updateMany({
      where: { caseId: companyCase.id, status: 'ACTIVE', expiresAt: { lte: now } },
      data: { status: 'EXPIRED', releasedAt: now },
    });
    if (expiredLeases.count > 0) {
      const timedOutAttempts = await tx.companyOsExecutionAttempt.updateMany({
        where: { caseId: companyCase.id, outcome: 'STARTED', finishedAt: null },
        data: { outcome: 'TIMED_OUT', errorCode: 'LEASE_EXPIRED', detail: 'Lease expired before completion', finishedAt: now },
      });
      await appendCaseEvent(tx, {
        caseId: companyCase.id, requestId: companyCase.requestId, eventType: 'LEASE_EXPIRED',
        fromStatus: companyCase.status, toStatus: companyCase.status,
        payload: { expiredLeases: expiredLeases.count, timedOutAttempts: timedOutAttempts.count },
        idempotencyKey: `case:${companyCase.requestId}:lease-expired:${await tx.companyOsExecutionAttempt.count({ where: { caseId: companyCase.id } })}`,
      });
    }
    await tx.companyOsLock.upsert({
      where: { requestId: companyCase.requestId },
      create: { requestId: companyCase.requestId, ownerToken: leaseToken, expiresAt },
      update: { ownerToken: leaseToken, expiresAt },
    });
    await tx.companyOsLock.upsert({ where: { requestId: GLOBAL_LOCK_ID }, create: { requestId: GLOBAL_LOCK_ID, ownerToken: `${leaseToken}:global`, expiresAt }, update: { ownerToken: `${leaseToken}:global`, expiresAt } });
    const priorAttempts = await tx.companyOsExecutionAttempt.count({ where: { requestId: companyCase.requestId } });
    const attempt = priorAttempts + 1;
    await tx.companyOsLease.create({ data: {
      caseId: companyCase.id, requestId: companyCase.requestId, leaseToken, ownerRef: WORKER_REF, expiresAt,
    } });
    await tx.companyOsExecutionAttempt.create({ data: {
      caseId: companyCase.id, requestId: companyCase.requestId, leaseToken, attempt, outcome: 'STARTED',
    } });
    await tx.companyOsHeartbeat.create({ data: {
      caseId: companyCase.id, requestId: companyCase.requestId, leaseToken, workerRef: WORKER_REF, phase: 'CLAIMED',
    } });
    await tx.companyOsCase.update({ where: { id: companyCase.id }, data: {
      status: 'ANALYZING',
      webhookDeliveryStatus: companyCase.webhookDeliveryStatus === 'FAILED' ? 'RECOVERED' : undefined,
    } });
    await appendCaseEvent(tx, {
      caseId: companyCase.id, requestId: companyCase.requestId, eventType: 'CASE_CLAIMED',
      fromStatus: companyCase.status, toStatus: 'ANALYZING', payload: { attempt, recovered: attempt > 1 },
      idempotencyKey: `case:${companyCase.requestId}:claim:${attempt}`,
    });
    return {
      caseId: companyCase.id, requestId: companyCase.requestId, agentId: companyCase.agentId, objective: companyCase.objective,
      leaseToken, leaseExpiresAt: expiresAt.toISOString(), attempt,
      evidencePayload, contextMessages,
      budgets: { input: inputBudget, maxOutputTokens: companyCase.maxOutputTokens, targetTotal: companyCase.targetTotalTokens },
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function activeLease(tx: Tx, requestId: string, leaseToken: string) {
  const lease = await tx.companyOsLease.findFirst({ where: { requestId, leaseToken, status: 'ACTIVE', expiresAt: { gt: new Date() } } });
  if (!lease) throw new Error('Lease inválido o ya liberado');
  const [requestLock, globalLock] = await Promise.all([
    tx.companyOsLock.findUnique({ where: { requestId } }), tx.companyOsLock.findUnique({ where: { requestId: GLOBAL_LOCK_ID } }),
  ]);
  if (requestLock?.ownerToken !== leaseToken || globalLock?.ownerToken !== `${leaseToken}:global`) throw new Error('El worker perdió la titularidad del lock');
  return lease;
}

export async function heartbeatCompanyOsCase(requestId: string, leaseToken: string, phase: string) {
  const db = companyOsV3Prisma();
  return db.$transaction(async (tx) => {
    const lease = await activeLease(tx, requestId, leaseToken);
    const expiresAt = new Date(Date.now() + LEASE_MS);
    await tx.companyOsLease.update({ where: { id: lease.id }, data: { expiresAt } });
    await tx.companyOsLock.update({ where: { requestId }, data: { expiresAt } });
    await tx.companyOsLock.update({ where: { requestId: GLOBAL_LOCK_ID }, data: { expiresAt } });
    return tx.companyOsHeartbeat.create({ data: {
      caseId: lease.caseId, requestId, leaseToken, workerRef: WORKER_REF, phase: phase.slice(0, 80),
    } });
  });
}

function validateWorkerResult(result: CompanyOsWorkerResult, knownRefs: Set<string>) {
  if (!result || typeof result.summary !== 'string' || typeof result.primaryDataQualityProblem !== 'string'
    || typeof result.recommendedNextStep !== 'string' || !Array.isArray(result.evidenceRefs) || !Array.isArray(result.missions)) {
    throw new Error('Resultado del worker inválido');
  }
  if (result.evidenceRefs.some((ref) => !knownRefs.has(ref))) throw new Error('El resultado contiene referencias de evidencia inventadas');
  if (result.missions.some((mission) => mission.status !== 'PLANNED' || mission.evidenceRefs.some((ref) => !knownRefs.has(ref)))) {
    throw new Error('V3 sólo acepta misiones PLANNED con evidencia materializada');
  }
}

function validateSystemsWorkerResult(
  result: CompanyOsSystemsWorkerResult,
  evidence: Array<{ evidenceKey: string; value: Prisma.JsonValue }>,
) {
  const knownRefs = new Set(evidence.map((entry) => entry.evidenceKey));
  if (!result || typeof result.summary !== 'string' || typeof result.primaryConfirmedRisk !== 'string'
    || typeof result.primaryCoverageGap !== 'string' || typeof result.confirmedRiskNextStep !== 'string'
    || typeof result.coverageGapNextStep !== 'string' || !Array.isArray(result.evidenceRefs)
    || !Array.isArray(result.actionableRisks) || result.actionableRisks.length > 5 || !Array.isArray(result.missions)) {
    throw new Error('Resultado del Gerente de Sistemas inválido');
  }
  const allRefs = [...result.evidenceRefs, ...result.actionableRisks.flatMap((risk) => risk.evidenceRefs), ...result.missions.flatMap((mission) => mission.evidenceRefs)];
  if (allRefs.some((ref) => !knownRefs.has(ref))) throw new Error('El resultado contiene evidencia inventada');
  const assetsEntry = evidence.find((entry) => entry.evidenceKey === 'assets')?.value;
  const risksEntry = evidence.find((entry) => entry.evidenceKey === 'risks')?.value;
  const assets = Array.isArray(assetsEntry) ? assetsEntry as Array<Record<string, unknown>> : [];
  const risks = Array.isArray(risksEntry) ? risksEntry as Array<Record<string, unknown>> : [];
  const assetIds = new Set(assets.map((asset) => String(asset.assetId)));
  const actionableRiskIds = new Set(risks.filter((risk) => risk.classification === 'ACTION_REQUIRED').map((risk) => String(risk.riskId)));
  if (result.actionableRisks.some((risk) => !assetIds.has(risk.assetId) || !actionableRiskIds.has(risk.riskId))) throw new Error('El resultado inventó un activo o riesgo no materializado');
  if (result.actionableRisks.some((risk) => risk.classification !== 'ACTION_REQUIRED' || !Number.isInteger(risk.priority) || risk.priority < 0 || risk.priority > 100)) throw new Error('Ranking técnico inválido');
  if (result.missions.some((mission) => mission.status !== 'PLANNED')) throw new Error('Sólo se aceptan misiones PLANNED');
}

export function estimateCompanyOsCost(usage: CompanyOsWorkerUsage) {
  const nonCachedInput = Math.max(0, usage.inputTokens - usage.cachedTokens - usage.cacheWriteTokens);
  return (nonCachedInput * 5 + usage.cachedTokens * 0.5 + usage.cacheWriteTokens * 6.25 + usage.outputTokens * 30) / 1_000_000;
}

export function startOfCompanyOsDay(now = new Date()) {
  const dateParts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
  const desiredWallTime = Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, 0, 0, 0);
  let candidate = desiredWallTime;
  const wallClock = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const parts = Object.fromEntries(wallClock.formatToParts(new Date(candidate))
      .filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
    const representedWallTime = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    candidate += desiredWallTime - representedWallTime;
  }
  return new Date(candidate);
}

export async function completeCompanyOsCase(input: {
  requestId: string; leaseToken: string; result: CompanyOsWorkerResult | CompanyOsSystemsWorkerResult; usage: CompanyOsWorkerUsage;
}) {
  const db = companyOsV3Prisma();
  return db.$transaction(async (tx) => {
    const existing = await tx.companyOsCase.findUnique({ where: { requestId: input.requestId } });
    if (!existing) throw new Error('Caso inexistente');
    if (existing.status === 'AWAITING_REVIEW' || existing.status === 'COMPLETED') return { reused: true, status: existing.status };
    if (existing.status === 'CANCELLED') throw new Error('El caso fue cancelado y no acepta resultados');
    const lease = await activeLease(tx, input.requestId, input.leaseToken);
    const refs = await tx.companyOsEvidenceRef.findMany({ where: { caseId: existing.id }, select: { evidenceKey: true, value: true } });
    const knownRefs = new Set(refs.map((ref) => ref.evidenceKey));
    if (existing.agentId === 'systems-manager-ai-v1') validateSystemsWorkerResult(input.result as CompanyOsSystemsWorkerResult, refs);
    else validateWorkerResult(input.result as CompanyOsWorkerResult, knownRefs);
    if (input.usage.totalTokens > existing.targetTotalTokens) throw new Error('Consumo total excede el presupuesto autorizado');

    await tx.companyOsMessage.create({ data: {
      caseId: existing.id, role: 'ASSISTANT', kind: 'RESULT', actorRef: WORKER_REF,
      content: JSON.stringify(redactResult(input.result)),
    } });
    if (input.result.missions.length) {
      await tx.companyOsMission.createMany({ data: input.result.missions.map((mission) => ({
        caseId: existing.id, title: mission.title,
        rationale: `Evidencia: ${mission.evidenceRefs.join(', ')}`,
        expectedOutput: mission.objective, status: 'PLANNED',
      })) });
    }
    const start = startOfCompanyOsDay();
    const daily = await tx.companyOsUsage.aggregate({
      where: { createdAt: { gte: start }, case: { agentId: existing.agentId } }, _sum: { totalTokens: true, estimatedCostUsd: true },
    });
    const estimatedCostUsd = estimateCompanyOsCost(input.usage);
    const dailyTotalTokens = (daily._sum.totalTokens ?? 0) + input.usage.totalTokens;
    const dailyCostUsd = Number(daily._sum.estimatedCostUsd ?? 0) + estimatedCostUsd;
    const dailyLimit = companyOsDailyTokenLimit(existing.agentId as CompanyOsAgentId);
    const pct = Math.round(dailyTotalTokens / dailyLimit * 100);
    const configuredAlerts = companyOsV3BudgetConfig().alerts;
    const alertLevel = configuredAlerts.filter((level) => pct >= level).sort((a, b) => b - a)[0] ?? null;
    await tx.companyOsUsage.create({ data: {
      caseId: existing.id, provider: input.usage.provider, model: input.usage.model,
      inputTokens: input.usage.inputTokens, cachedTokens: input.usage.cachedTokens,
      cacheWriteTokens: input.usage.cacheWriteTokens, outputTokens: input.usage.outputTokens,
      reasoningTokens: input.usage.reasoningTokens, totalTokens: input.usage.totalTokens,
      estimatedCostUsd, dailyTotalTokens, dailyCostUsd, alertLevel,
      responseId: input.usage.responseId ?? null, durationMs: input.usage.durationMs ?? null, retries: input.usage.retries ?? 0,
      snapshotBytes: input.usage.snapshotBytes ?? null, rulesApplied: jsonValue(input.usage.rulesApplied ?? []),
    } });
    const toStatus: CompanyOsRequestStatus = input.result.missions.length ? 'AWAITING_REVIEW' : 'COMPLETED';
    await tx.companyOsCase.update({ where: { id: existing.id }, data: {
      status: toStatus, completedAt: toStatus === 'COMPLETED' ? new Date() : null,
    } });
    await tx.companyOsLease.update({ where: { id: lease.id }, data: { status: 'COMPLETED', releasedAt: new Date() } });
    await tx.companyOsLock.deleteMany({ where: { ownerToken: { in: [input.leaseToken, `${input.leaseToken}:global`] } } });
    await tx.companyOsExecutionAttempt.update({
      where: { requestId_attempt: { requestId: input.requestId, attempt: await tx.companyOsExecutionAttempt.count({ where: { requestId: input.requestId } }) } },
      data: { outcome: 'SUCCEEDED', finishedAt: new Date() },
    });
    await appendCaseEvent(tx, {
      caseId: existing.id, requestId: input.requestId, eventType: 'ANALYSIS_COMPLETED',
      fromStatus: 'ANALYZING', toStatus, payload: { evidenceRefs: input.result.evidenceRefs, totalTokens: input.usage.totalTokens, alertLevel },
      idempotencyKey: `case:${input.requestId}:completed`,
    });
    if (existing.agentId === 'systems-manager-ai-v1') {
      await appendCaseEvent(tx, {
        caseId: existing.id, requestId: input.requestId, eventType: 'HANDOFF_TO_GENERAL_MANAGER',
        fromStatus: toStatus, toStatus, payload: { fromAgentId: existing.agentId, toAgentId: COMPANY_OS_V3_IDENTITY, executionAuthorized: false },
        idempotencyKey: `case:${input.requestId}:handoff:${COMPANY_OS_V3_IDENTITY}`,
      });
    }
    await tx.companyOsAuditEvent.create({ data: {
      requestId: input.requestId, action: 'ANALYSIS_COMPLETED', actorRef: WORKER_REF,
      metadata: jsonValue({ businessWrites: 0, infrastructureWrites: 0, agentId: existing.agentId, requestStatus: toStatus, missionsCreated: input.result.missions.length }),
      idempotencyKey: `audit:${input.requestId}:completed`,
    } });
    return { reused: false, status: toStatus, estimatedCostUsd, dailyTotalTokens, alertLevel };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function failCompanyOsCase(requestId: string, leaseToken: string, errorCode: string, detail: string) {
  const db = companyOsV3Prisma();
  return db.$transaction(async (tx) => {
    const lease = await activeLease(tx, requestId, leaseToken);
    const companyCase = await tx.companyOsCase.findUniqueOrThrow({ where: { requestId } });
    const attempt = await tx.companyOsExecutionAttempt.findFirstOrThrow({ where: { requestId, leaseToken } });
    await tx.companyOsExecutionAttempt.update({ where: { id: attempt.id }, data: {
      outcome: errorCode === 'MODEL_TIMEOUT' ? 'TIMED_OUT' : 'FAILED', errorCode: errorCode.slice(0, 80), detail: detail.slice(0, 500), finishedAt: new Date(),
    } });
    await tx.companyOsLease.update({ where: { id: lease.id }, data: { status: 'FAILED', releasedAt: new Date() } });
    await tx.companyOsLock.deleteMany({ where: { ownerToken: { in: [leaseToken, `${leaseToken}:global`] } } });
    await tx.companyOsCase.update({ where: { id: companyCase.id }, data: { status: 'FAILED' } });
    await appendCaseEvent(tx, {
      caseId: companyCase.id, requestId, eventType: 'ANALYSIS_FAILED', fromStatus: 'ANALYZING', toStatus: 'FAILED',
      payload: { errorCode, detail: detail.slice(0, 200) }, idempotencyKey: `case:${requestId}:failed:${attempt.attempt}`,
    });
    return { status: 'FAILED' as const };
  });
}

async function notificationContext(tx: Tx, requestId: string, leaseToken: string) {
  const companyCase = await tx.companyOsCase.findUniqueOrThrow({ where: { requestId } });
  const lease = await tx.companyOsLease.findFirst({ where: { requestId, leaseToken } });
  if (!lease || lease.caseId !== companyCase.id) throw new Error('Lease de notificación inválido');
  const riskEvidence = await tx.companyOsEvidenceRef.findUnique({
    where: { caseId_evidenceKey: { caseId: companyCase.id, evidenceKey: 'risks' } }, select: { value: true },
  });
  return { companyCase, evidenceFingerprint: riskEvidence ? hash(JSON.stringify(riskEvidence.value)) : hash(requestId) };
}

export async function prepareCompanyOsNotification(input: { requestId: string; leaseToken: string }) {
  const db = companyOsV3Prisma();
  return db.$transaction(async (tx) => {
    const { companyCase, evidenceFingerprint } = await notificationContext(tx, input.requestId, input.leaseToken);
    const previous = await tx.companyOsNotificationDelivery.findMany({
      where: { requestId: input.requestId, channel: 'TELEGRAM', eventType: 'ANALYSIS_COMPLETED' },
      orderBy: { attempt: 'desc' },
    });
    const delivered = previous.find((item) => item.status === 'DELIVERED');
    if (delivered) return { send: false, reused: true, delivery: delivered };
    const pending = previous.find((item) => item.status === 'PENDING' && !previous.some((candidate) => candidate.attempt === item.attempt && ['DELIVERED','FAILED'].includes(candidate.status)));
    if (pending) return { send: false, reused: true, delivery: pending, uncertain: true };
    const contractDuplicate = await tx.companyOsNotificationDelivery.findFirst({
      where: {
        agentId: companyCase.agentId,
        channel: 'TELEGRAM',
        eventType: 'ANALYSIS_COMPLETED',
        evidenceFingerprint,
        assetId: null,
        status: 'DELIVERED',
      },
    });
    if (contractDuplicate) return { send: false, reused: true, delivery: contractDuplicate };
    const attempt = Math.max(0, ...previous.map((item) => item.attempt)) + 1;
    if (attempt > 2) throw new Error('Telegram agotó el único reintento permitido');
    const reservation = await tx.companyOsNotificationDelivery.create({ data: {
      caseId: companyCase.id, requestId: input.requestId, agentId: companyCase.agentId,
      evidenceFingerprint, channel: 'TELEGRAM', eventType: 'ANALYSIS_COMPLETED',
      status: 'PENDING', attempt, responseCode: null, errorDetail: null,
      idempotencyKey: `telegram:${companyCase.agentId}:${input.requestId}:completed:intent:${attempt}`,
    } });
    return { send: true, reused: false, reservationId: reservation.id, attempt };
  });
}

export async function recordCompanyOsNotification(input: {
  requestId: string; leaseToken: string; reservationId: string; status: 'DELIVERED' | 'FAILED'; responseCode?: number | null; errorDetail?: string | null;
}) {
  const db = companyOsV3Prisma();
  return db.$transaction(async (tx) => {
    const { companyCase, evidenceFingerprint } = await notificationContext(tx, input.requestId, input.leaseToken);
    const reservation = await tx.companyOsNotificationDelivery.findFirst({ where: {
      id: input.reservationId, caseId: companyCase.id, requestId: input.requestId, channel: 'TELEGRAM', status: 'PENDING',
    } });
    if (!reservation) throw new Error('Reserva de notificación inválida');
    const existing = await tx.companyOsNotificationDelivery.findUnique({ where: {
      idempotencyKey: `telegram:${companyCase.agentId}:${input.requestId}:completed:result:${reservation.attempt}`,
    } });
    if (existing) return { reused: true, delivery: existing };
    const delivery = await tx.companyOsNotificationDelivery.create({ data: {
      caseId: companyCase.id, requestId: input.requestId, agentId: companyCase.agentId,
      evidenceFingerprint, channel: 'TELEGRAM', eventType: 'ANALYSIS_COMPLETED', status: input.status,
      attempt: reservation.attempt, responseCode: input.responseCode ?? null, errorDetail: input.errorDetail?.slice(0, 500) ?? null,
      idempotencyKey: `telegram:${companyCase.agentId}:${input.requestId}:completed:result:${reservation.attempt}`,
    } });
    await appendCaseEvent(tx, {
      caseId: companyCase.id, requestId: input.requestId,
      eventType: input.status === 'DELIVERED' ? 'TELEGRAM_DELIVERED' : 'TELEGRAM_DELIVERY_FAILED',
      payload: { responseCode: input.responseCode ?? null, errorDetail: input.errorDetail?.slice(0, 200) ?? null },
      idempotencyKey: `case:${input.requestId}:telegram:completed:${reservation.attempt}`,
    });
    return { reused: false, delivery };
  });
}

export async function getCompanyOsCase(requestId: string) {
  const db = companyOsV3Prisma();
  const companyCase = await db.companyOsCase.findUnique({ where: { requestId }, include: {
    messages: { orderBy: { createdAt: 'asc' } }, events: { orderBy: { sequence: 'asc' } },
    evidence: { orderBy: { evidenceKey: 'asc' } }, missions: { orderBy: { createdAt: 'asc' } },
    decisions: { orderBy: { createdAt: 'asc' } }, usage: { orderBy: { createdAt: 'asc' } },
    heartbeats: { orderBy: { createdAt: 'asc' } }, attempts: { orderBy: { attempt: 'asc' } },
    deliveries: { orderBy: { createdAt: 'asc' } }, leases: { orderBy: { createdAt: 'asc' } },
  } });
  if (!companyCase) return null;
  const auditEvents = await db.companyOsAuditEvent.findMany({ where: { requestId }, orderBy: { createdAt: 'asc' } });
  return { ...companyCase, auditEvents };
}

export async function listCompanyOsCases(limit = 30, agentId?: CompanyOsAgentId) {
  const db = companyOsV3Prisma();
  const cases = await db.companyOsCase.findMany({
    where: agentId ? { agentId } : undefined,
    take: Math.min(Math.max(limit, 1), 100), orderBy: { createdAt: 'desc' },
    include: { messages: { orderBy: { createdAt: 'asc' } }, events: { orderBy: { sequence: 'asc' } }, evidence: { orderBy: { evidenceKey: 'asc' } }, usage: true, missions: true, heartbeats: { take: 1, orderBy: { createdAt: 'desc' } } },
  });
  const auditEvents = cases.length === 0 ? [] : await db.companyOsAuditEvent.findMany({
    where: { requestId: { in: cases.map((companyCase) => companyCase.requestId) } },
    orderBy: { createdAt: 'asc' },
  });
  const auditsByRequest = new Map<string, typeof auditEvents>();
  for (const audit of auditEvents) {
    const group = auditsByRequest.get(audit.requestId) ?? [];
    group.push(audit);
    auditsByRequest.set(audit.requestId, group);
  }
  return cases.map((companyCase) => ({ ...companyCase, auditEvents: auditsByRequest.get(companyCase.requestId) ?? [] }));
}

export async function appendCompanyOsContext(requestId: string, content: string, identity: Identity) {
  const trimmed = sanitizeCompanyText(content, 4000).safeText;
  if (!trimmed || trimmed.length > 4000) throw new Error('El contexto debe tener entre 1 y 4000 caracteres');
  const db = companyOsV3Prisma();
  return db.$transaction(async (tx) => {
    const companyCase = await tx.companyOsCase.findUniqueOrThrow({ where: { requestId } });
    if (TERMINAL_REQUEST_STATUSES.has(companyCase.status as CompanyOsRequestStatus)) throw new Error('El caso ya no admite contexto adicional');
    const message = await tx.companyOsMessage.create({ data: {
      caseId: companyCase.id, role: 'USER', kind: 'CONTEXT', content: trimmed, actorRef: identity.actorRef,
    } });
    await appendCaseEvent(tx, {
      caseId: companyCase.id, requestId, eventType: 'CONTEXT_APPENDED', payload: { messageId: message.id },
      idempotencyKey: `case:${requestId}:context:${message.id}`,
    });
    await tx.companyOsAuditEvent.create({ data: {
      requestId, action: 'CONTEXT_APPENDED', actorRef: identity.actorRef,
      metadata: jsonValue({ businessWrites: 0, infrastructureWrites: 0, messageId: message.id }),
      idempotencyKey: `audit:${requestId}:context:${message.id}`,
    } });
    return message;
  });
}

export async function cancelCompanyOsCase(requestId: string, reason: string, identity: Identity) {
  const db = companyOsV3Prisma();
  return db.$transaction(async (tx) => {
    const companyCase = await tx.companyOsCase.findUniqueOrThrow({ where: { requestId } });
    const fromStatus = companyCase.status as CompanyOsRequestStatus;
    if (TERMINAL_REQUEST_STATUSES.has(fromStatus)) return { reused: true, status: fromStatus };
    await tx.companyOsCase.update({ where: { id: companyCase.id }, data: { status: 'CANCELLED', cancellationReason: reason.slice(0, 500) } });
    await tx.companyOsLease.updateMany({ where: { caseId: companyCase.id, status: 'ACTIVE' }, data: { status: 'RELEASED', releasedAt: new Date() } });
    const requestLock = await tx.companyOsLock.findUnique({ where: { requestId }, select: { ownerToken: true } });
    if (requestLock) await tx.companyOsLock.deleteMany({ where: { ownerToken: { in: [requestLock.ownerToken, `${requestLock.ownerToken}:global`] } } });
    await appendCaseEvent(tx, {
      caseId: companyCase.id, requestId, eventType: 'CASE_CANCELLED', fromStatus, toStatus: 'CANCELLED',
      payload: { reason: reason.slice(0, 500), actorRef: identity.actorRef }, idempotencyKey: `case:${requestId}:cancelled`,
    });
    await tx.companyOsAuditEvent.create({ data: {
      requestId, action: 'CASE_CANCELLED', actorRef: identity.actorRef,
      metadata: jsonValue({ businessWrites: 0, infrastructureWrites: 0, fromStatus, toStatus: 'CANCELLED' }),
      idempotencyKey: `audit:${requestId}:cancelled`,
    } });
    return { reused: false, status: 'CANCELLED' as const };
  });
}

type AtomicMissionDecisionOps<TMission extends { status: string }, TResult> = {
  findExisting: () => Promise<TResult | null>;
  lockMission: () => Promise<TMission>;
  targetStatus: string;
  readCurrent: (mission: TMission) => Promise<TResult> | TResult;
  persist: (mission: TMission) => Promise<TResult>;
};

export async function resolveAtomicMissionDecision<TMission extends { status: string }, TResult>(
  ops: AtomicMissionDecisionOps<TMission, TResult>,
) {
  const existing = await ops.findExisting();
  if (existing) return { reused: true, value: existing } as const;

  const mission = await ops.lockMission();
  const existingAfterLock = await ops.findExisting();
  if (existingAfterLock) return { reused: true, value: existingAfterLock } as const;

  if (mission.status === 'RUNNING' || mission.status === 'DONE') {
    throw new Error('V3 no autoriza modificar misiones en ejecución o ejecutadas');
  }
  if (['APPROVED', 'REJECTED', 'BLOCKED'].includes(mission.status)) {
    const target = ops.targetStatus;
    if (mission.status === target) return { reused: true, value: await ops.readCurrent(mission) } as const;
    throw new Error('La misión ya tiene una decisión humana terminal');
  }
  return { reused: false, value: await ops.persist(mission) } as const;
}

type LockedMissionRow = {
  id: string;
  caseId: string;
  title: string;
  rationale: string;
  expectedOutput: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  caseStatus: string;
};

type PersistedMissionDecision = {
  requestHash?: string;
  detail?: Record<string, unknown>;
  result?: { mission: LockedMissionRow; caseStatus: string; executionAuthorized: false };
};

function parsePersistedMissionDecision(value: string | null) {
  if (!value) return null;
  try { return JSON.parse(value) as PersistedMissionDecision; } catch { return null; }
}

export async function decideCompanyOsMission(input: {
  requestId: string; missionId: string; decision: 'APPROVE' | 'REJECT' | 'REQUEST_REVIEW' | 'BLOCK' | 'EDIT' | 'POSTPONE' | 'MARK_INCORRECT';
  reason?: string; revision?: { title?: string; rationale?: string; expectedOutput?: string }; deferUntil?: string; idempotencyKey: string;
}, identity: Identity) {
  const transitions: Record<typeof input.decision, CompanyOsMissionStatus> = {
    APPROVE: 'APPROVED', REJECT: 'REJECTED', REQUEST_REVIEW: 'REVIEW', BLOCK: 'BLOCKED',
    EDIT: 'REVIEW', POSTPONE: 'REVIEW', MARK_INCORRECT: 'BLOCKED',
  };
  const target = transitions[input.decision];
  if (!COMPANY_OS_MISSION_STATUSES.includes(target) || target === 'RUNNING' || target === 'DONE') throw new Error('V3 no autoriza ejecución de misiones');
  const requestHash = hash(JSON.stringify({
    requestId: input.requestId,
    missionId: input.missionId,
    decision: input.decision,
    reason: input.reason ?? null,
    revision: input.revision ?? null,
    deferUntil: input.deferUntil ?? null,
  }));
  const db = companyOsV3Prisma();
  return db.$transaction(async (tx) => {
    const findExisting = async () => {
      const existing = await tx.companyOsDecision.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: { case: { select: { requestId: true, status: true } }, mission: true },
      });
      if (!existing) return null;
      if (existing.case.requestId !== input.requestId || existing.missionId !== input.missionId || !existing.mission) {
        throw new Error('La idempotencyKey ya pertenece a otra decisión');
      }
      const persisted = parsePersistedMissionDecision(existing.reason);
      if (existing.decision !== input.decision || (persisted?.requestHash && persisted.requestHash !== requestHash)) {
        throw new Error('La idempotencyKey fue reutilizada con otro contenido');
      }
      if (persisted?.result) return persisted.result;
      return { mission: existing.mission, caseStatus: existing.case.status, executionAuthorized: false };
    };

    const resolved = await resolveAtomicMissionDecision({
      findExisting,
      targetStatus: target,
      readCurrent: (mission) => ({ mission, caseStatus: mission.caseStatus, executionAuthorized: false }),
      lockMission: async () => {
        const rows = await tx.$queryRaw<LockedMissionRow[]>(Prisma.sql`
          SELECT m.id, m."caseId", m.title, m.rationale, m."expectedOutput", m.status,
            m."createdAt", m."updatedAt", c.status AS "caseStatus"
          FROM public."CompanyOsMission" m
          JOIN public."CompanyOsCase" c ON c.id = m."caseId"
          WHERE c."requestId" = ${input.requestId} AND m.id = ${input.missionId}
          LIMIT 1
          FOR UPDATE OF c, m
        `);
        if (!rows[0]) throw new Error('Misión Company OS inexistente');
        return rows[0];
      },
      persist: async (mission) => {
        let decisionDetail: Record<string, unknown> = { reason: sanitizeCompanyText(input.reason ?? '', 1000).safeText || null };
        if (input.decision !== 'APPROVE' && !decisionDetail.reason) throw new Error('La decisión requiere un motivo auditable');
        let missionUpdate: { status: CompanyOsMissionStatus; title?: string; rationale?: string; expectedOutput?: string } = { status: target };
        if (input.decision === 'EDIT') {
          const title = sanitizeCompanyText(input.revision?.title ?? '', 1000).safeText;
          const rationale = sanitizeCompanyText(input.revision?.rationale ?? '', 1000).safeText;
          const expectedOutput = sanitizeCompanyText(input.revision?.expectedOutput ?? '', 1000).safeText;
          if (!title || !rationale || !expectedOutput) throw new Error('La edición requiere título, motivo y entregable');
          missionUpdate = { status: target, title, rationale, expectedOutput };
          decisionDetail = { ...decisionDetail, revision: { title, rationale, expectedOutput } };
        }
        if (input.decision === 'POSTPONE') {
          const deferUntil = new Date(input.deferUntil ?? '');
          if (!Number.isFinite(deferUntil.getTime())) throw new Error('Fecha de postergación inválida');
          decisionDetail = { ...decisionDetail, deferUntil: deferUntil.toISOString() };
        }
        if (input.decision === 'MARK_INCORRECT' && !decisionDetail.reason) throw new Error('Debe indicar qué información es incorrecta');
        const openReviewsBefore = await tx.companyOsMission.count({ where: { caseId: mission.caseId, status: { in: ['PLANNED', 'REVIEW'] } } });
        const openReviewsAfter = ['PLANNED', 'REVIEW'].includes(target) ? openReviewsBefore : Math.max(0, openReviewsBefore - 1);
        const resultingCaseStatus = openReviewsAfter === 0 && mission.caseStatus === 'AWAITING_REVIEW' ? 'COMPLETED' : mission.caseStatus;
        const lockedMission = { id: mission.id, caseId: mission.caseId, title: mission.title, rationale: mission.rationale, expectedOutput: mission.expectedOutput, status: mission.status, createdAt: mission.createdAt, updatedAt: mission.updatedAt };
        const result = { mission: { ...lockedMission, ...missionUpdate }, caseStatus: resultingCaseStatus, executionAuthorized: false as const };
        await tx.companyOsDecision.create({ data: {
          caseId: mission.caseId, missionId: mission.id, decision: input.decision,
          reason: JSON.stringify({ requestHash, detail: decisionDetail, result }),
          actorRef: identity.actorRef, idempotencyKey: input.idempotencyKey,
        } });
        await tx.companyOsMission.update({ where: { id: mission.id }, data: missionUpdate });
        await appendCaseEvent(tx, {
          caseId: mission.caseId, requestId: input.requestId, eventType: 'MISSION_DECIDED',
          payload: { missionId: mission.id, decision: input.decision, fromMissionStatus: mission.status, toMissionStatus: target, executionAuthorized: false, detail: decisionDetail },
          idempotencyKey: `case:${input.requestId}:mission:${input.idempotencyKey}`,
        });
        await tx.companyOsAuditEvent.create({ data: {
          requestId: input.requestId, action: 'MISSION_DECIDED', actorRef: identity.actorRef,
          metadata: jsonValue({ businessWrites: 0, infrastructureWrites: 0, missionId: mission.id, decision: input.decision, executionAuthorized: false }),
          idempotencyKey: `audit:${input.requestId}:mission:${input.idempotencyKey}`,
        } });
        const openReviews = await tx.companyOsMission.count({ where: { caseId: mission.caseId, status: { in: ['PLANNED', 'REVIEW'] } } });
        if (openReviews === 0 && mission.caseStatus === 'AWAITING_REVIEW') {
          await tx.companyOsCase.update({ where: { id: mission.caseId }, data: { status: 'COMPLETED', completedAt: new Date() } });
          await appendCaseEvent(tx, {
            caseId: mission.caseId, requestId: input.requestId, eventType: 'CASE_COMPLETED',
            fromStatus: 'AWAITING_REVIEW', toStatus: 'COMPLETED', payload: { reason: 'HUMAN_REVIEW_CLOSED', executionAuthorized: false },
            idempotencyKey: `case:${input.requestId}:human-review-completed`,
          });
        }
        return result;
      },
    });
    return { reused: resolved.reused, ...resolved.value };
  });
}

type RiskReviewRow = { id: string; snapshotId: string; caseId: string; evidenceId: string; currentStatus: string };

export async function decideCompanyOsRisk(input: {
  requestId: string; riskId: string; decision: 'ACKNOWLEDGE'|'POSTPONE'|'MARK_INCORRECT'|'COMMENT';
  reason: string; deferUntil?: string; idempotencyKey: string;
}, identity: Identity) {
  const rationale = sanitizeCompanyText(input.reason, 1000).safeText;
  if (!rationale) throw new Error('La decisión de riesgo requiere motivo');
  const eventType = { ACKNOWLEDGE: 'ACKNOWLEDGED', POSTPONE: 'POSTPONED', MARK_INCORRECT: 'MARKED_INCORRECT', COMMENT: 'COMMENTED' }[input.decision];
  const toStatus = { ACKNOWLEDGE: 'ACKNOWLEDGED', POSTPONE: 'POSTPONED', MARK_INCORRECT: 'MARKED_INCORRECT', COMMENT: 'OPEN' }[input.decision];
  let deferUntil: string | null = null;
  if (input.decision === 'POSTPONE') {
    const parsed = new Date(input.deferUntil ?? '');
    if (!Number.isFinite(parsed.getTime())) throw new Error('Fecha de postergación inválida');
    deferUntil = parsed.toISOString();
  }
  const db = companyOsV3Prisma();
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<RiskReviewRow[]>(Prisma.sql`
      SELECT r.id, r."snapshotId", r."caseId", r."evidenceId",
        COALESCE((SELECT h."toStatus" FROM public."CompanyOsSystemRiskHistory" h WHERE h."riskId" = r.id ORDER BY h."createdAt" DESC LIMIT 1), r.status) AS "currentStatus"
      FROM public."CompanyOsSystemRisk" r
      JOIN public."CompanyOsCase" c ON c.id = r."caseId"
      WHERE c."requestId" = ${input.requestId} AND c."agentId" = 'systems-manager-ai-v1' AND r."riskKey" = ${input.riskId}
      LIMIT 1
    `);
    const risk = rows[0];
    if (!risk) throw new Error('Riesgo técnico inexistente');
    const inserted = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      INSERT INTO public."CompanyOsSystemRiskHistory"
        (id, "riskId", "snapshotId", "caseId", "eventType", "fromStatus", "toStatus", "actorRef", rationale, "evidenceId", "idempotencyKey")
      VALUES (${randomUUID()}, ${risk.id}, ${risk.snapshotId}, ${risk.caseId}, ${eventType}, ${risk.currentStatus}, ${toStatus},
        ${identity.actorRef}, ${deferUntil ? `${rationale} · revisar después de ${deferUntil}` : rationale}, ${risk.evidenceId}, ${input.idempotencyKey})
      ON CONFLICT ("idempotencyKey") DO NOTHING RETURNING id
    `);
    if (inserted.length === 0) return { reused: true, riskId: input.riskId, status: toStatus };
    await appendCaseEvent(tx, {
      caseId: risk.caseId, requestId: input.requestId, eventType: 'RISK_REVIEWED',
      payload: { riskId: input.riskId, decision: input.decision, fromStatus: risk.currentStatus, toStatus, deferUntil, executionAuthorized: false },
      idempotencyKey: `case:${input.requestId}:risk:${input.idempotencyKey}`,
    });
    await tx.companyOsAuditEvent.create({ data: {
      requestId: input.requestId, action: 'RISK_REVIEWED', actorRef: identity.actorRef,
      metadata: jsonValue({ businessWrites: 0, infrastructureWrites: 0, riskId: input.riskId, decision: input.decision, executionAuthorized: false }),
      idempotencyKey: `audit:${input.requestId}:risk:${input.idempotencyKey}`,
    } });
    return { reused: false, riskId: input.riskId, status: toStatus, executionAuthorized: false };
  });
}

export function assertRequestStatus(value: string): asserts value is CompanyOsRequestStatus {
  if (!COMPANY_OS_REQUEST_STATUSES.includes(value as CompanyOsRequestStatus)) throw new Error('Estado de solicitud inválido');
}
