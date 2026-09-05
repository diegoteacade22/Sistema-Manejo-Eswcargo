import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { companyOsV3Prisma } from './v3-prisma';
import {
  baselineObjectiveUnits, blockedExternalSourceUnit, objectiveHash, observeObjectiveUnit, planObjectiveSource,
  safeObjectiveMetadata, validateContinuousObjectiveInput, type ObjectiveSourceCandidate,
  OBJECTIVE_SETTLED_CASE_STATUSES,
} from './continuous-objective-policy';
import {
  CONTINUOUS_OBJECTIVE_ALLOWED_PROJECTS, CONTINUOUS_OBJECTIVE_EXTERNAL_SOURCES, ContinuousObjectiveError,
  type ContinuousObjectiveAgentId, type ContinuousObjectiveExternalSourceId, type ContinuousObjectiveIdentity, type ContinuousObjectiveUnitView,
  type ContinuousObjectiveView, type ControlContinuousObjectiveInput, type CreateContinuousObjectiveInput,
  type PendingContinuousObjectiveUnit,
} from './continuous-objective-types';
import { liveExternalSourceUnit } from './continuous-objective-policy';

export * from './continuous-objective-types';
type Tx = Prisma.TransactionClient;
export type ContinuousObjectiveDefinition = Omit<ContinuousObjectiveView, 'counts' | 'units'>;
type GoalRow = Omit<ContinuousObjectiveDefinition, 'startsAt' | 'endsAt' | 'nextScanAt' | 'lastScanAt' | 'createdAt' | 'updatedAt'> & {
  startsAt: Date; endsAt: Date; nextScanAt: Date; lastScanAt: Date | null; createdAt: Date; updatedAt: Date;
  scanCursor: string; scanObserved: number; scanExcluded: number; scanDomains: ContinuousObjectiveAgentId[];
  externalSources: ContinuousObjectiveExternalSourceId[];
};
type UnitRow = Omit<ContinuousObjectiveUnitView, 'createdAt' | 'updatedAt'> & { createdAt: Date; updatedAt: Date };
const SCAN_PAGE_SIZE = 200;
const SYSTEM_ACTOR = 'continuous-objective-planner-v1';
const emptyCounts = () => ({ planned: 0, queued: 0, analyzed: 0, verified: 0, needsReview: 0, blocked: 0, skipped: 0 });
const statusCountKeys = { PLANNED: 'planned', QUEUED: 'queued', ANALYZED: 'analyzed', VERIFIED: 'verified', NEEDS_REVIEW: 'needsReview', BLOCKED: 'blocked', SKIPPED: 'skipped' } as const;

function json(value: unknown) { return JSON.stringify(value); }
function iso(value: Date | string) { return new Date(value).toISOString(); }
function actor(identity: ContinuousObjectiveIdentity) {
  if (typeof identity !== 'string' || identity.trim().length < 2 || identity.length > 200) throw new ContinuousObjectiveError('Identidad inválida', 401);
  // Store an opaque identity reference rather than an email or other personal identifier.
  return `actor:${objectiveHash(identity.trim()).slice(0, 32)}`;
}
function key(raw: unknown, actorRef: string) {
  if (typeof raw !== 'string' || !/^[A-Za-z0-9:_-]{16,160}$/.test(raw)) throw new ContinuousObjectiveError('Clave idempotente inválida');
  return `human:${actorRef}:${raw}`;
}
function goalDefinition(row: GoalRow): ContinuousObjectiveDefinition {
  return {
    id: row.id, version: row.version, controlRevision: row.controlRevision, title: row.title, objective: row.objective,
    status: row.status, startsAt: iso(row.startsAt), endsAt: iso(row.endsAt), projectAllowlist: row.projectAllowlist,
    externalSources: row.externalSources,
    criteria: row.criteria, scanIntervalMinutes: row.scanIntervalMinutes, nextScanAt: iso(row.nextScanAt),
    createdBy: row.createdBy, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt),
    lastScanAt: row.lastScanAt ? iso(row.lastScanAt) : null, sourcesObserved: row.sourcesObserved, sourcesExcluded: row.sourcesExcluded,
  };
}
function unitView(row: UnitRow): ContinuousObjectiveUnitView {
  return { ...row, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) };
}
function pendingView(row: UnitRow, goal: GoalRow): PendingContinuousObjectiveUnit {
  return { ...unitView(row), unitId: row.id, objective: goal.objective, criteria: goal.criteria, goalTitle: goal.title };
}
async function appendEvent(tx: Tx, input: {
  goalId: string; unitId?: string; eventType: string; actorRef?: string; idempotencyKey: string; requestHash?: string; payload?: unknown;
}) {
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO public."CompanyOsObjectiveEvent" (id,"goalId","unitId","eventType","actorRef","idempotencyKey","requestHash",payload)
    VALUES (${randomUUID()},${input.goalId},${input.unitId ?? null},${input.eventType},${input.actorRef ?? SYSTEM_ACTOR},
      ${input.idempotencyKey},${input.requestHash ?? null},${json(input.payload ?? {})}::jsonb)
    ON CONFLICT ("idempotencyKey") DO NOTHING
  `);
}
async function fullView(tx: Tx, goal: GoalRow): Promise<ContinuousObjectiveView> {
  const units = await tx.$queryRaw<UnitRow[]>(Prisma.sql`
    SELECT * FROM public."CompanyOsObjectiveUnit" WHERE "goalId"=${goal.id} ORDER BY "createdAt" DESC,id LIMIT 50
  `);
  const totals = await tx.$queryRaw<Array<{ status: ContinuousObjectiveUnitView['status']; count: number }>>(Prisma.sql`
    SELECT status,count(*)::integer AS count FROM public."CompanyOsObjectiveUnit" WHERE "goalId"=${goal.id} GROUP BY status
  `);
  const counts = emptyCounts();
  for (const total of totals) counts[statusCountKeys[total.status]] = total.count;
  return { ...goalDefinition(goal), status: new Date(goal.endsAt) <= new Date() ? 'EXPIRED' : goal.status, counts, units: units.map(unitView) };
}
async function replay(tx: Tx, idempotencyKey: string, requestHash: string) {
  const events = await tx.$queryRaw<Array<{ goalId: string; requestHash: string }>>(Prisma.sql`
    SELECT "goalId","requestHash" FROM public."CompanyOsObjectiveEvent" WHERE "idempotencyKey"=${idempotencyKey}
  `);
  if (!events[0]) return null;
  if (events[0].requestHash !== requestHash) throw new ContinuousObjectiveError('La clave ya se usó con otra solicitud', 409, 'IDEMPOTENCY_CONFLICT');
  const rows = await tx.$queryRaw<GoalRow[]>(Prisma.sql`SELECT * FROM public."CompanyOsContinuousObjective" WHERE id=${events[0].goalId}`);
  return { objective: await fullView(tx, rows[0]), reused: true };
}

export async function listContinuousObjectives() {
  return companyOsV3Prisma().$transaction(async (tx) => {
    const goals = await tx.$queryRaw<GoalRow[]>(Prisma.sql`
      SELECT * FROM public."CompanyOsContinuousObjective" ORDER BY "createdAt" DESC,id LIMIT 50
    `);
    const objectives = [];
    for (const goal of goals) objectives.push(await fullView(tx, goal));
    const externalSources = [];
    for (const source of CONTINUOUS_OBJECTIVE_EXTERNAL_SOURCES) {
      const dependencyKey = `external-${source.id.toLowerCase().replaceAll('_', '-')}`;
      const observations = await tx.$queryRaw<Array<{ status: string; observedAt: Date }>>(Prisma.sql`
        SELECT status,"observedAt" FROM public."CompanyOsDependencyObservation"
        WHERE "dependencyKey"=${dependencyKey} ORDER BY "observedAt" DESC LIMIT 1
      `);
      const live = observations[0] && observations[0].status === 'HEALTHY'
        && new Date().getTime() - new Date(observations[0].observedAt).getTime() <= 30 * 60_000;
      externalSources.push({ ...source,
        status: live ? 'LIVE_READONLY' : source.status,
        note: live
          ? source.id === 'CHATGPT_WORK'
            ? 'Puente local de índice/exportación observado en modo read-only; no representa acceso directo al historial de ChatGPT Work.'
            : 'Runtime independiente conectado y observado con permisos de sólo lectura.'
          : source.note,
      });
    }
    return { objectives, allowedProjects: [...CONTINUOUS_OBJECTIVE_ALLOWED_PROJECTS], externalSources };
  });
}

export async function createContinuousObjective(input: CreateContinuousObjectiveInput, identity: ContinuousObjectiveIdentity) {
  const normalized = validateContinuousObjectiveInput(input);
  const actorRef = actor(identity);
  const idempotencyKey = key(input.idempotencyKey, actorRef);
  const requestHash = objectiveHash({ action: 'CREATE', normalized: normalized.requestHash });
  return companyOsV3Prisma().$transaction(async (tx) => {
    // Serializes create/replay and the maximum of three live objectives, across all API instances.
    await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext('company-os-continuous-objective-create'))::text`);
    await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${idempotencyKey}))::text`);
    const reused = await replay(tx, idempotencyKey, requestHash);
    if (reused) return reused;
    const [{ count }] = await tx.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      SELECT count(*)::integer AS count FROM public."CompanyOsContinuousObjective"
      WHERE status IN ('ACTIVE','PAUSED') AND "endsAt">clock_timestamp()
    `);
    if (count >= 3) throw new ContinuousObjectiveError('Ya hay tres objetivos vigentes; esperá su vencimiento', 409, 'OBJECTIVE_LIMIT');
    const rows = await tx.$queryRaw<GoalRow[]>(Prisma.sql`
      INSERT INTO public."CompanyOsContinuousObjective" (id,title,objective,status,"startsAt","endsAt","projectAllowlist","externalSources",criteria,"scanIntervalMinutes","nextScanAt","createdBy")
      VALUES (${randomUUID()},${normalized.title},${normalized.objective},'ACTIVE',${normalized.startsAt},${normalized.endDate},
        ${json(normalized.projectAllowlist)}::jsonb,${json(normalized.externalSources)}::jsonb,${json(normalized.criteria)}::jsonb,${normalized.scanIntervalMinutes},${normalized.startsAt},${actorRef}) RETURNING *
    `);
    await appendEvent(tx, { goalId: rows[0].id, eventType: 'OBJECTIVE_CREATED', actorRef, idempotencyKey, requestHash,
      payload: { version: 1, projectAllowlist: normalized.projectAllowlist, externalSources: normalized.externalSources, endsAt: normalized.endDate.toISOString(), verificationScope: 'ANALYSIS_ONLY' } });
    return { objective: await fullView(tx, rows[0]), reused: false };
  });
}

export async function controlContinuousObjective(input: ControlContinuousObjectiveInput, identity: ContinuousObjectiveIdentity) {
  const actorRef = actor(identity);
  const idempotencyKey = key(input.idempotencyKey, actorRef);
  if (!['PAUSE', 'RESUME'].includes(input.action) || !Number.isInteger(input.expectedVersion) || !Number.isInteger(input.expectedControlRevision)
    || typeof input.objectiveId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(input.objectiveId)) {
    throw new ContinuousObjectiveError('Control de objetivo inválido');
  }
  const requestHash = objectiveHash({ action: input.action, goalId: input.objectiveId, version: input.expectedVersion, controlRevision: input.expectedControlRevision });
  return companyOsV3Prisma().$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${idempotencyKey}))::text`);
    // The objective is always locked before its units/cases; worker claims use the same order.
    const rows = await tx.$queryRaw<GoalRow[]>(Prisma.sql`SELECT * FROM public."CompanyOsContinuousObjective" WHERE id=${input.objectiveId} FOR UPDATE`);
    if (!rows[0]) throw new ContinuousObjectiveError('Objetivo no encontrado', 404, 'OBJECTIVE_NOT_FOUND');
    const reused = await replay(tx, idempotencyKey, requestHash);
    if (reused) return reused;
    const goal = rows[0];
    if (goal.version !== input.expectedVersion || goal.controlRevision !== input.expectedControlRevision) {
      throw new ContinuousObjectiveError('El objetivo cambió; actualizá la pantalla', 409, 'OBJECTIVE_CHANGED');
    }
    if (goal.status === 'EXPIRED' || new Date(goal.endsAt) <= new Date()) throw new ContinuousObjectiveError('El objetivo venció y no puede reactivarse', 409, 'OBJECTIVE_EXPIRED');
    const expected = input.action === 'PAUSE' ? 'ACTIVE' : 'PAUSED';
    if (goal.status !== expected) throw new ContinuousObjectiveError('El objetivo ya está en ese estado', 409, 'OBJECTIVE_CHANGED');
    const updated = await tx.$queryRaw<GoalRow[]>(Prisma.sql`
      UPDATE public."CompanyOsContinuousObjective" SET status=${input.action === 'PAUSE' ? 'PAUSED' : 'ACTIVE'},
        "controlRevision"="controlRevision"+1,"updatedAt"=clock_timestamp(),
        "nextScanAt"=CASE WHEN ${input.action}='RESUME' THEN clock_timestamp() ELSE "nextScanAt" END
      WHERE id=${goal.id} RETURNING *
    `);
    await appendEvent(tx, { goalId: goal.id, eventType: input.action === 'PAUSE' ? 'OBJECTIVE_PAUSED' : 'OBJECTIVE_RESUMED',
      actorRef, idempotencyKey, requestHash, payload: { version: goal.version, controlRevision: updated[0].controlRevision } });
    return { objective: await fullView(tx, updated[0]), reused: false };
  });
}

// Only read declared metadata from in-scope projects; no transcript, reply, credential or personal task body.
async function sourceCandidates(tx: Tx, goal: GoalRow, sourceId?: string) {
  if (goal.projectAllowlist.length === 0) return [];
  return tx.$queryRaw<ObjectiveSourceCandidate[]>(Prisma.sql`
    SELECT task.id,task."threadId",CASE WHEN task.category='PERSONAL' THEN '' ELSE task.title END AS title,
      task."projectName",task.category,task."humanStatus",task."sourceStatus",task.archived,task.priority,
      CASE WHEN task.category='PERSONAL' THEN '' ELSE task."nextAction" END AS "nextAction",
      CASE WHEN task.category='PERSONAL' THEN NULL ELSE task."resultSummary" END AS "resultSummary",
      task.fingerprint,CASE WHEN task."attentionReason" IS NULL THEN NULL ELSE 'PRESENT' END AS "attentionReason",
      board."workflowStatus" AS "boardStatus",board.lifecycle AS "boardLifecycle",board."projectNameOverride"
    FROM public."CompanyOsCodexTask" task
    LEFT JOIN public."CompanyOsCodexTaskBoardState" board ON board."taskId"=task.id
    WHERE task."projectName" IN (${Prisma.join(goal.projectAllowlist)})
      AND ${sourceId ? Prisma.sql`task.id=${sourceId}` : Prisma.sql`task.id>${goal.scanCursor}`}
    ORDER BY task.id LIMIT ${sourceId ? 1 : SCAN_PAGE_SIZE}
  `);
}

async function observeResults(tx: Tx, goal: GoalRow) {
  const units = await tx.$queryRaw<Array<UnitRow & {
    caseStatus: string; hasPendingWork: boolean; resultMessageId: string | null; resultPayload: Record<string, unknown> | null;
    evidenceIds: string[];
  }>>(Prisma.sql`
    SELECT unit.*,c.status AS "caseStatus",m.id AS "resultMessageId",m.payload AS "resultPayload",
      EXISTS(SELECT 1 FROM public."CompanyOsWorkItem" w WHERE w."caseId"=c.id AND w.status IN ('QUEUED','CLAIMED','RUNNING','FAILED_RETRYABLE')) AS "hasPendingWork",
      COALESCE((SELECT jsonb_agg(e.id ORDER BY e.id) FROM public."CompanyOsEvidenceRef" e WHERE e."caseId"=c.id
        AND e."evidenceKey" IN ('metrics','quality','freshness','assets','dependencies','health','coverage','risks','systemsSnapshot','systems-snapshot','dataSnapshot','data-snapshot')), '[]'::jsonb) AS "evidenceIds"
    FROM public."CompanyOsObjectiveUnit" unit
    JOIN public."CompanyOsCase" c ON c.id=unit."caseId"
    LEFT JOIN LATERAL (SELECT id,payload FROM public."CompanyOsMessage" WHERE "caseId"=c.id
      AND kind='RESULT' AND "fromAgentId"='general-manager-ai-v3' ORDER BY "createdAt" DESC,id DESC LIMIT 1) m ON true
    WHERE unit."goalId"=${goal.id} AND unit.status IN ('QUEUED','BLOCKED','NEEDS_REVIEW')
    FOR UPDATE OF unit
  `);
  for (const unit of units) {
    const output = unit.resultPayload ?? {};
    const result = observeObjectiveUnit({ caseStatus: unit.caseStatus, hasPendingWork: unit.hasPendingWork,
      resultMessageId: unit.resultMessageId, confidence: typeof output.confidence === 'number' ? output.confidence : null,
      needsHumanDecision: typeof output.needsHumanDecision === 'boolean' ? output.needsHumanDecision : null,
      evidenceIds: unit.evidenceIds, sourceKind: unit.source.kind, resultSummary: typeof output.summary === 'string' ? output.summary : null });
    if (!result || (result.status === unit.status && result.resultSummary === unit.resultSummary && json(result.resultEvidence) === json(unit.resultEvidence))) continue;
    await tx.$executeRaw(Prisma.sql`UPDATE public."CompanyOsObjectiveUnit" SET status=${result.status},"resultSummary"=${result.resultSummary},
      "resultEvidence"=${json(result.resultEvidence)}::jsonb,"updatedAt"=clock_timestamp() WHERE id=${unit.id}`);
    await appendEvent(tx, { goalId: goal.id, unitId: unit.id, eventType: 'UNIT_PROGRESS',
      idempotencyKey: `progress:${unit.id}:${objectiveHash(result)}`, payload: { ...result, caseId: unit.caseId, sourceResolved: false, verificationScope: 'ANALYSIS_ONLY' } });
  }
}

async function insertPlannedUnit(tx: Tx, goal: GoalRow, planned: Omit<ReturnType<typeof baselineObjectiveUnits>[number], 'ownerAgentId'> & { ownerAgentId: ContinuousObjectiveAgentId }) {
  const rows = await tx.$queryRaw<UnitRow[]>(Prisma.sql`
    INSERT INTO public."CompanyOsObjectiveUnit" (id,"goalId",version,"sourceId",fingerprint,status,"ownerAgentId",priority,source)
    VALUES (${randomUUID()},${goal.id},${goal.version},${planned.sourceId},${planned.fingerprint},'PLANNED',${planned.ownerAgentId},${planned.priority},${json(planned.source)}::jsonb)
    ON CONFLICT ("goalId",version,"sourceId",fingerprint) DO NOTHING RETURNING *
  `);
  if (rows[0]) await appendEvent(tx, { goalId: goal.id, unitId: rows[0].id, eventType: 'UNIT_PLANNED',
    idempotencyKey: `planned:${rows[0].id}`, payload: { sourceId: planned.sourceId, fingerprint: planned.fingerprint, ownerAgentId: planned.ownerAgentId } });
  return rows.length;
}

async function insertBlockedExternalUnit(tx: Tx, goal: GoalRow, sourceId: ContinuousObjectiveExternalSourceId) {
  const blocked = blockedExternalSourceUnit(sourceId);
  const rows = await tx.$queryRaw<UnitRow[]>(Prisma.sql`
    INSERT INTO public."CompanyOsObjectiveUnit" (id,"goalId",version,"sourceId",fingerprint,status,"ownerAgentId",priority,source,"resultSummary")
    VALUES (${randomUUID()},${goal.id},${goal.version},${blocked.sourceId},${blocked.fingerprint},'BLOCKED',${blocked.ownerAgentId},${blocked.priority},${json(blocked.source)}::jsonb,
      ${blocked.source.reportedResult})
    ON CONFLICT ("goalId",version,"sourceId",fingerprint) DO NOTHING RETURNING *
  `);
  if (rows[0]) await appendEvent(tx, { goalId: goal.id, unitId: rows[0].id, eventType: 'EXTERNAL_SOURCE_BLOCKED',
    idempotencyKey: `external-blocked:${goal.id}:${sourceId}`, payload: { sourceId, status: CONTINUOUS_OBJECTIVE_EXTERNAL_SOURCES.find((source) => source.id === sourceId)?.status,
      verificationScope: 'ANALYSIS_ONLY' } });
  return rows.length;
}

async function latestExternalObservation(tx: Tx, sourceId: ContinuousObjectiveExternalSourceId, now: Date) {
  const dependencyKey = `external-${sourceId.toLowerCase().replaceAll('_', '-')}`;
  const rows = await tx.$queryRaw<Array<{ status: string; detail: string | null; observedAt: Date }>>(Prisma.sql`
    SELECT status,detail,"observedAt" FROM public."CompanyOsDependencyObservation"
    WHERE "dependencyKey"=${dependencyKey} ORDER BY "observedAt" DESC LIMIT 1
  `);
  const observed = rows[0];
  if (!observed || observed.status !== 'HEALTHY' || now.getTime() - new Date(observed.observedAt).getTime() > 30 * 60_000) return null;
  return observed;
}

async function insertLiveExternalUnit(tx: Tx, goal: GoalRow, sourceId: ContinuousObjectiveExternalSourceId, detail: string | null) {
  const live = liveExternalSourceUnit(sourceId, detail);
  const promoted = await tx.$queryRaw<UnitRow[]>(Prisma.sql`
    UPDATE public."CompanyOsObjectiveUnit" SET version=${goal.version},fingerprint=${live.fingerprint},status='PLANNED',source=${json(live.source)}::jsonb,
      "resultSummary"=NULL,"updatedAt"=clock_timestamp()
    WHERE "goalId"=${goal.id} AND "sourceId"=${live.sourceId} AND status='BLOCKED' RETURNING *
  `);
  if (promoted[0]) {
    await appendEvent(tx, { goalId: goal.id, unitId: promoted[0].id, eventType: 'UNIT_PLANNED',
      idempotencyKey: `live-planned:${promoted[0].id}:${live.fingerprint}`, payload: { sourceId, live: true, verificationScope: 'ANALYSIS_ONLY' } });
    return 1;
  }
  return insertPlannedUnit(tx, goal, { ...live, ownerAgentId: 'general-manager-ai-v3' });
}

/** Deterministic only. Returns at most one candidate per goal; the callback below owns atomic case creation. */
export async function planContinuousObjectiveUnits(input: {
  limit?: number; now?: Date; baselineFingerprints?: Partial<Record<ContinuousObjectiveAgentId, string>>;
} = {}) {
  const now = input.now ?? new Date();
  const limit = Math.max(1, Math.min(3, Math.floor(input.limit ?? 3)));
  return companyOsV3Prisma().$transaction(async (tx) => {
    const goals = await tx.$queryRaw<GoalRow[]>(Prisma.sql`
      SELECT goal.* FROM public."CompanyOsContinuousObjective" goal WHERE status IN ('ACTIVE','PAUSED')
        OR EXISTS(SELECT 1 FROM public."CompanyOsObjectiveUnit" unit WHERE unit."goalId"=goal.id AND unit.status IN ('QUEUED','BLOCKED','NEEDS_REVIEW'))
      ORDER BY "nextScanAt",id FOR UPDATE OF goal SKIP LOCKED LIMIT 50
    `);
    const pendingUnits: PendingContinuousObjectiveUnit[] = [];
    let scannedObjectives = 0; let observed = 0; let excluded = 0; let planned = 0;
    let eligibleSources = 0; let blockedExternal = 0;
    for (const goal of goals) {
      await observeResults(tx, goal);
      if (goal.status === 'EXPIRED') continue;
      if (new Date(goal.endsAt) <= now) {
        await tx.$executeRaw(Prisma.sql`UPDATE public."CompanyOsContinuousObjective" SET status='EXPIRED',"controlRevision"="controlRevision"+1,"updatedAt"=clock_timestamp() WHERE id=${goal.id}`);
        await appendEvent(tx, { goalId: goal.id, eventType: 'OBJECTIVE_EXPIRED', idempotencyKey: `expired:${goal.id}`, payload: { endsAt: iso(goal.endsAt) } });
        continue;
      }
      if (goal.status !== 'ACTIVE' || new Date(goal.startsAt) > now) continue;
      if (new Date(goal.nextScanAt) <= now && scannedObjectives < limit) {
        const candidates = await sourceCandidates(tx, goal);
        const domains = new Set(goal.scanDomains);
        let pageExcluded = 0;
        for (const candidate of candidates) {
          const result = planObjectiveSource(candidate, goal.projectAllowlist);
          if ('excluded' in result) { pageExcluded += 1; continue; }
          eligibleSources += 1;
          domains.add(result.ownerAgentId);
          planned += await insertPlannedUnit(tx, goal, result);
        }
        const complete = candidates.length < SCAN_PAGE_SIZE;
        if (complete) for (const sourceId of goal.externalSources) {
          const observation = await latestExternalObservation(tx, sourceId, now);
          planned += observation
            ? await insertLiveExternalUnit(tx, goal, sourceId, observation.detail)
            : await insertBlockedExternalUnit(tx, goal, sourceId);
          if (!observation) blockedExternal += 1;
        }
        if (complete && goal.projectAllowlist.length > 0) for (const baseline of baselineObjectiveUnits(goal, [...domains], input.baselineFingerprints)) {
          planned += await insertPlannedUnit(tx, goal, baseline);
        }
        const totalObserved = goal.scanObserved + candidates.length;
        const totalExcluded = goal.scanExcluded + pageExcluded;
        const cursor = complete ? '' : candidates[candidates.length - 1].id;
        await tx.$executeRaw(Prisma.sql`
          UPDATE public."CompanyOsContinuousObjective" SET "scanCursor"=${cursor},
            "scanObserved"=${complete ? 0 : totalObserved},"scanExcluded"=${complete ? 0 : totalExcluded},
            "scanDomains"=${json(complete ? [] : [...domains])}::jsonb,
            "sourcesObserved"=${totalObserved},"sourcesExcluded"=${totalExcluded},"lastScanAt"=${now},
            "nextScanAt"=${new Date(now.getTime() + goal.scanIntervalMinutes * 60_000)},"updatedAt"=clock_timestamp()
          WHERE id=${goal.id}
        `);
        await appendEvent(tx, { goalId: goal.id, eventType: 'OBJECTIVE_SCANNED',
          idempotencyKey: `scan:${goal.id}:${randomUUID()}`,
          payload: { observed: candidates.length, excluded: pageExcluded, totalObserved, totalExcluded, complete, cursor,
            scope: 'ALLOWLISTED_PROJECT_METADATA', excludedReasons: 'Personal, activa, archivada, fuera de alcance o requiere decisión', llmCalls: 0 } });
        scannedObjectives += 1; observed += candidates.length; excluded += pageExcluded;
      }
      const candidates = await tx.$queryRaw<UnitRow[]>(Prisma.sql`
        SELECT * FROM public."CompanyOsObjectiveUnit" unit WHERE "goalId"=${goal.id} AND status='PLANNED'
        AND NOT EXISTS (SELECT 1 FROM public."CompanyOsObjectiveUnit" active LEFT JOIN public."CompanyOsCase" c ON c.id=active."caseId"
          WHERE active."goalId"=${goal.id} AND (active.status='QUEUED'
            OR c.status NOT IN (${Prisma.join(OBJECTIVE_SETTLED_CASE_STATUSES)})
            OR EXISTS(SELECT 1 FROM public."CompanyOsWorkItem" w WHERE w."caseId"=c.id AND w.status IN ('QUEUED','CLAIMED','RUNNING','FAILED_RETRYABLE'))))
        ORDER BY priority,
          COALESCE((SELECT max(prior."updatedAt") FROM public."CompanyOsObjectiveUnit" prior
            WHERE prior."goalId"=unit."goalId" AND prior."ownerAgentId"=unit."ownerAgentId" AND prior."caseId" IS NOT NULL), '-infinity'::timestamptz),
          CASE "ownerAgentId" WHEN 'systems-manager-ai-v1' THEN 0 WHEN 'data-manager-ai-v1' THEN 1 ELSE 2 END,
          "createdAt",id LIMIT 1
      `);
      if (candidates[0]) pendingUnits.push(pendingView(candidates[0], goal));
    }
    const noWorkReason = pendingUnits.length > 0
      ? 'READY_TO_CLAIM'
      : blockedExternal > 0 && eligibleSources === 0
        ? 'EXTERNAL_SOURCE_BLOCKED'
        : eligibleSources > 0
          ? 'NO_NEW_UNIT_AFTER_DEDUPE_OR_IN_FLIGHT'
          : scannedObjectives === 0
            ? 'NO_DUE_OBJECTIVE'
            : observed > 0 && excluded > 0
              ? 'ALL_OBSERVED_SOURCES_EXCLUDED'
              : 'NO_ELIGIBLE_SOURCE';
    return { scannedObjectives, observed, excluded, planned, eligibleSources, blockedExternal, noWorkReason, pendingUnits };
  }, { timeout: 30_000 });
}

/** Lock order: objective -> unit -> case/work in the callback. No remote calls inside the callback. */
export async function withContinuousObjectiveUnitClaim(
  unitId: string,
  createCase: (tx: Tx, unit: PendingContinuousObjectiveUnit, goal: ContinuousObjectiveDefinition) => Promise<string>,
): Promise<{ claimed: boolean; caseId?: string; unitId: string; reason?: string }> {
  if (typeof unitId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(unitId)) throw new ContinuousObjectiveError('Unidad inválida');
  return companyOsV3Prisma().$transaction(async (tx) => {
    const goals = await tx.$queryRaw<GoalRow[]>(Prisma.sql`
      SELECT goal.* FROM public."CompanyOsContinuousObjective" goal WHERE goal.id=(SELECT "goalId" FROM public."CompanyOsObjectiveUnit" WHERE id=${unitId}) FOR UPDATE
    `);
    const goal = goals[0];
    if (!goal) return { claimed: false, unitId, reason: 'UNIT_NOT_FOUND' };
    const [{ eligible }] = await tx.$queryRaw<Array<{ eligible: boolean }>>(Prisma.sql`
      SELECT (status='ACTIVE' AND "startsAt"<=clock_timestamp() AND "endsAt">clock_timestamp()) AS eligible
      FROM public."CompanyOsContinuousObjective" WHERE id=${goal.id}
    `);
    if (!eligible) return { claimed: false, unitId, reason: 'OBJECTIVE_NOT_ACTIVE' };
    const units = await tx.$queryRaw<UnitRow[]>(Prisma.sql`SELECT * FROM public."CompanyOsObjectiveUnit" WHERE id=${unitId} FOR UPDATE`);
    const unit = units[0];
    if (unit.status !== 'PLANNED') return { claimed: false, unitId, caseId: unit.caseId ?? undefined, reason: 'ALREADY_MATERIALIZED' };
    const active = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT active.id FROM public."CompanyOsObjectiveUnit" active LEFT JOIN public."CompanyOsCase" c ON c.id=active."caseId"
      WHERE active."goalId"=${goal.id} AND (active.status='QUEUED'
        OR c.status NOT IN (${Prisma.join(OBJECTIVE_SETTLED_CASE_STATUSES)})
        OR EXISTS(SELECT 1 FROM public."CompanyOsWorkItem" w WHERE w."caseId"=c.id AND w.status IN ('QUEUED','CLAIMED','RUNNING','FAILED_RETRYABLE'))) LIMIT 1
    `);
    if (active.length) return { claimed: false, unitId, reason: 'OBJECTIVE_CASE_ALREADY_QUEUED' };
    if (unit.source.kind === 'CODEX_METADATA') {
      const candidates = await sourceCandidates(tx, goal, unit.sourceId.slice('codex:'.length));
      const current = candidates[0] ? planObjectiveSource(candidates[0], goal.projectAllowlist) : null;
      if (!current || 'excluded' in current || current.fingerprint !== unit.fingerprint) {
        await tx.$executeRaw(Prisma.sql`UPDATE public."CompanyOsObjectiveUnit" SET status='SKIPPED',"resultSummary"='La fuente cambió o ya no es elegible; no se ejecutó.',"updatedAt"=clock_timestamp() WHERE id=${unit.id}`);
        await appendEvent(tx, { goalId: goal.id, unitId, eventType: 'UNIT_SOURCE_CHANGED', idempotencyKey: `source-changed:${unit.id}` });
        return { claimed: false, unitId, reason: 'SOURCE_CHANGED' };
      }
    }
    const caseId = await createCase(tx, pendingView(unit, goal), goalDefinition(goal));
    if (typeof caseId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(caseId)) throw new ContinuousObjectiveError('El creador no devolvió un caso válido', 500);
    await tx.$executeRaw(Prisma.sql`UPDATE public."CompanyOsObjectiveUnit" SET status='QUEUED',"caseId"=${caseId},"updatedAt"=clock_timestamp() WHERE id=${unit.id}`);
    await appendEvent(tx, { goalId: goal.id, unitId, eventType: 'UNIT_QUEUED', idempotencyKey: `queued:${unit.id}`,
      payload: { caseId, ownerAgentId: unit.ownerAgentId, verificationScope: 'ANALYSIS_ONLY' } });
    return { claimed: true, unitId, caseId };
  }, { timeout: 30_000 });
}
