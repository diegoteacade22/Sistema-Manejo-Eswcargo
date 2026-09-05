import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  baselineObjectiveUnits, deduplicateObjectiveSources, observeObjectiveUnit, planObjectiveSource,
  planExternalSourceItem, safeObjectiveMetadata, validateContinuousObjectiveInput, type ObjectiveSourceCandidate,
  objectiveCaseInFlight,
} from '../lib/company-os/continuous-objective-policy';
import { createContinuousObjective, controlContinuousObjective, isFreshExternalSnapshot, planContinuousObjectiveUnits, withContinuousObjectiveUnitClaim } from '../lib/company-os/continuous-objectives';
import { objectiveHash } from '../lib/company-os/continuous-objective-policy';
import { formatExternalSourceDependencyDetail, parseRuntimeExternalSourceBatches } from '../lib/company-os/runtime-external-items';
import { sanitizeCompanyText } from '../lib/company-os/objective';

const input = { title: 'Continuidad operativa', objective: 'Reducir pendientes empresariales con evidencia', criteria: ['Identificar el siguiente paso verificable'],
  projectAllowlist: ['AGENTE MANAGER'], externalSources: [], durationDays: 30, idempotencyKey: 'ui:continuous:create:1234' };
const now = new Date('2026-09-03T04:00:00Z');
const source: ObjectiveSourceCandidate = { id: 'task-123456', threadId: 'thread-123456', title: 'Verificar la ingesta de datos', projectName: 'AGENTE MANAGER',
  category: 'OPERATIONS', humanStatus: 'UNREVIEWED', sourceStatus: 'IDLE', archived: false, priority: 3,
  nextAction: 'Revisar el estado de la ingesta', resultSummary: null, fingerprint: 'a'.repeat(64), attentionReason: null };

test('valida alcance cerrado, máximo30 días y mínimo15 minutos; reintento conserva hash', () => {
  const first = validateContinuousObjectiveInput(input, now);
  const retried = validateContinuousObjectiveInput(input, new Date(now.getTime() + 1000));
  assert.equal(first.requestHash, retried.requestHash);
  assert.equal(first.endDate.getTime() - now.getTime(), 30 * 86_400_000);
  assert.throws(() => validateContinuousObjectiveInput({ ...input, durationDays: 31 }, now));
  assert.throws(() => validateContinuousObjectiveInput({ ...input, projectAllowlist: ['PERSONAL'] }, now));
  assert.throws(() => validateContinuousObjectiveInput({ ...input, scanIntervalMinutes: 14 }, now));
  assert.throws(() => validateContinuousObjectiveInput({ ...input, criteria: [] }, now));
});

test('fuente sólo metadata: sin transcript ni prueba de cierre y owner Data', () => {
  const planned = planObjectiveSource(source, input.projectAllowlist);
  assert.ok(!('excluded' in planned));
  assert.equal(planned.ownerAgentId, 'data-manager-ai-v1');
  assert.equal(planned.source.authority, 'UNTRUSTED_METADATA_ONLY');
  assert.equal(planned.source.verificationScope, 'ANALYSIS_ONLY');
  assert.equal(planned.sourceId, 'codex:task-123456');
});

test('excluye personales, activos, archivados y pedidos de Diego aun con overlay viejo', () => {
  for (const patch of [
    { category: 'PERSONAL' }, { sourceStatus: 'ACTIVE' }, { sourceStatus: 'UNKNOWN' }, { archived: true },
    { boardLifecycle: 'ARCHIVED' }, { boardLifecycle: 'CLOSED' }, { humanStatus: 'NEEDS_DIEGO' },
    { boardStatus: 'NEEDS_DIEGO' }, { humanStatus: 'BLOCKED' }, { boardStatus: 'IN_PROGRESS' },
    { projectNameOverride: 'PERSONAL' }, { attentionReason: 'PRESENT' },
  ]) assert.ok('excluded' in planObjectiveSource({ ...source, ...patch }, input.projectAllowlist), JSON.stringify(patch));
});

test('sólo considera IDLE observado y conserva una unidad por raíz coherente', () => {
  assert.equal('excluded' in planObjectiveSource({ ...source, sourceStatus: 'NOT_LOADED' }, input.projectAllowlist), true);
  assert.equal('excluded' in planObjectiveSource({ ...source, sourceStatus: 'UNKNOWN' }, input.projectAllowlist), true);
  const roots = deduplicateObjectiveSources([
    { ...source, id: 'task-z', threadId: 'root-1', priority: 4 },
    { ...source, id: 'task-a', threadId: 'child-1', rootThreadId: 'root-1', priority: 2 },
    { ...source, id: 'task-b', threadId: 'root-2', priority: 2 },
  ]);
  assert.deepEqual(roots.map((candidate) => candidate.id), ['task-a', 'task-b']);
});

test('una fuente externa exige snapshot fresco y autoridad canónica por origen', () => {
  const proof = (authority: string) => 'read_only=true;items_schema=v1;items_count=1;snapshot_id=snapshot:' + 'a'.repeat(32)
    + ';evidence_hash=' + 'b'.repeat(64) + ';complete=true;authority_mode=' + authority + ';cursor_hash=' + 'c'.repeat(64);
  const observedAt = new Date('2026-09-03T03:50:00Z');
  assert.equal(isFreshExternalSnapshot('GOOGLE_DRIVE', { status: 'HEALTHY', detail: proof('GOOGLE_SERVICE_ACCOUNT_READONLY'), observedAt }, now), true);
  assert.equal(isFreshExternalSnapshot('GOOGLE_DRIVE', { status: 'HEALTHY', detail: 'read_only=true', observedAt }, now), false);
  assert.equal(isFreshExternalSnapshot('GOOGLE_DRIVE', { status: 'HEALTHY', detail: proof('GOOGLE_SERVICE_ACCOUNT_READONLY'), observedAt: new Date(now.getTime() - 31 * 60_000) }, now), false);
  assert.equal(isFreshExternalSnapshot('CHATGPT_WORK', { status: 'HEALTHY', detail: proof('GOOGLE_SERVICE_ACCOUNT_READONLY'), observedAt }, now), false);
  assert.equal(isFreshExternalSnapshot('CHATGPT_WORK', { status: 'HEALTHY', detail: proof('AUTHORIZED_CHATGPT_WORK_EXPORT_V1'), observedAt }, now), true);
  assert.equal(isFreshExternalSnapshot('GOOGLE_CONTACTS', { status: 'HEALTHY', detail: proof('GOOGLE_SERVICE_ACCOUNT_READONLY'), observedAt }, now), false);
});

test('batch externo durable verifica identidad de revisión y planifica sin PII', () => {
  const item = { itemKey: '1'.repeat(64), providerRevisionHash: '2'.repeat(64), itemKind: 'SHEET_METADATA',
    changeKind: 'UPDATED', sourceUpdatedAt: '2026-09-03T03:45:00.000Z' };
  const revisionFingerprint = createHash('sha256').update(JSON.stringify({ sourceId: 'GOOGLE_SHEETS', ...item })).digest('hex');
  const items = [{ ...item, revisionFingerprint }];
  const evidenceHash = createHash('sha256').update(JSON.stringify(items)).digest('hex');
  const batch = { schemaVersion: 1, sourceId: 'GOOGLE_SHEETS', status: 'HEALTHY', readOnly: true,
    authorityMode: 'GOOGLE_SERVICE_ACCOUNT_READONLY', principalRefHash: '3'.repeat(64), observedAt: observedIso(), capturedAt: observedIso(),
    snapshotId: `snapshot:${evidenceHash.slice(0, 32)}`, evidenceHash, complete: true, cursorHash: '4'.repeat(64), items };
  const parsed = parseRuntimeExternalSourceBatches([{ itemBatch: batch }], now);
  assert.equal(parsed[0].items.length, 1);
  const planned = planExternalSourceItem({ id: 'external-row', sourceId: 'GOOGLE_SHEETS', ...parsed[0].items[0] }, '2026-09-04T04:00:00Z');
  assert.equal(planned.ownerAgentId, 'data-manager-ai-v1');
  assert.equal(planned.source.kind, 'EXTERNAL_ITEM_METADATA');
  assert.equal(planned.source.deadline, '2026-09-04T04:00:00.000Z');
  assert.doesNotMatch(JSON.stringify(planned), /title@example|provider|spreadsheetId|content/i);
  assert.equal(observeObjectiveUnit({ ...completed, sourceKind: 'EXTERNAL_ITEM_METADATA', evidenceIds: ['snapshot-1234'] })?.status, 'ANALYZED');
});

test('detalle estructurado conserva hashes validados aunque el redactor libre detecte un número', () => {
  const evidenceHash = `a${'1'.repeat(12)}${'b'.repeat(51)}`;
  const batch = {
    schemaVersion: 1 as const, sourceId: 'GOOGLE_SHEETS' as const, status: 'HEALTHY' as const, readOnly: true as const,
    authorityMode: 'GOOGLE_SERVICE_ACCOUNT_READONLY', principalRefHash: 'd'.repeat(64), observedAt: observedIso(), capturedAt: observedIso(),
    snapshotId: `snapshot:${evidenceHash.slice(0, 32)}`, evidenceHash, complete: false, cursorHash: 'c'.repeat(64), items: [],
  };
  const detail = formatExternalSourceDependencyDetail(batch);
  assert.match(sanitizeCompanyText(detail, 500).safeText, /NUMBER_REDACTED/);
  assert.match(detail, new RegExp(`evidence_hash=${evidenceHash}(?:;|$)`));
  assert.equal(isFreshExternalSnapshot('GOOGLE_SHEETS', { status: 'HEALTHY', detail, observedAt: now }, now), true);
});

function observedIso() { return '2026-09-03T03:50:00.000Z'; }

test('dedupe no depende del fingerprint temporal del colector, pero cambia con hechos', () => {
  const first = planObjectiveSource(source, input.projectAllowlist);
  const repeated = planObjectiveSource({ ...source, fingerprint: 'b'.repeat(64) }, input.projectAllowlist);
  const changed = planObjectiveSource({ ...source, resultSummary: 'Se observó una ingesta incompleta' }, input.projectAllowlist);
  assert.ok(!('excluded' in first) && !('excluded' in repeated) && !('excluded' in changed));
  assert.equal(first.fingerprint, repeated.fingerprint);
  assert.notEqual(first.fingerprint, changed.fingerprint);
});

test('baselines cubren dominios ausentes, prioridad Systems→Data, sin duplicado por reloj', () => {
  const first = baselineObjectiveUnits(input, []);
  const repeated = baselineObjectiveUnits(input, []);
  assert.equal(first.length, 2);
  assert.deepEqual(first, repeated);
  assert.deepEqual(first.map((unit) => unit.priority), [0, 1]);
  assert.equal(baselineObjectiveUnits(input, ['systems-manager-ai-v1']).length, 1);
  const changed = baselineObjectiveUnits(input, [], { 'data-manager-ai-v1': 'new-stable-data-facts' });
  assert.equal(first[0].fingerprint, changed[0].fingerprint);
  assert.notEqual(first[1].fingerprint, changed[1].fingerprint);
});

test('sanea secretos, datos de contacto, rutas y enlaces antes de persistir metadata', () => {
  const value = safeObjectiveMetadata('token=secret-value diego@example.com https://internal.example/a /Users/private/project');
  assert.ok(!value.includes('secret-value'));
  assert.ok(!value.includes('example.com'));
  assert.ok(!value.includes('internal.example'));
  assert.ok(!value.includes('/Users'));
});

const completed = { caseStatus: 'COMPLETED', hasPendingWork: false, resultMessageId: 'general-result-1234', confidence: 0.9,
  needsHumanDecision: false, evidenceIds: [] as string[], resultSummary: 'Se identificó el siguiente paso.' };
test('metadata-only se marca ANALYZED, no escala falso pedido ni certifica tarea fuente', () => {
  const observed = observeObjectiveUnit(completed);
  assert.equal(observed?.status, 'ANALYZED');
  assert.match(observed!.resultSummary, /No certifica la ejecución de la tarea fuente/);
  assert.deepEqual(observed?.resultEvidence, ['message:general-result-1234']);
  assert.equal(observeObjectiveUnit({ ...completed, evidenceIds: ['snapshot-1234'] })?.status, 'VERIFIED');
  assert.equal(observeObjectiveUnit({ ...completed, sourceKind: 'CODEX_METADATA', evidenceIds: ['snapshot-1234'] })?.status, 'ANALYZED');
});

test('no convierte marcador/resumen en cierre: exige resultado General y conserva bloqueos genuinos', () => {
  assert.equal(observeObjectiveUnit({ ...completed, resultMessageId: null })?.status, 'NEEDS_REVIEW');
  assert.equal(observeObjectiveUnit({ ...completed, needsHumanDecision: true })?.status, 'NEEDS_REVIEW');
  assert.equal(observeObjectiveUnit({ ...completed, confidence: 0.7 })?.status, 'NEEDS_REVIEW');
  assert.equal(observeObjectiveUnit({ ...completed, hasPendingWork: true }), null);
  assert.equal(observeObjectiveUnit({ ...completed, caseStatus: 'BLOCKED' })?.status, 'BLOCKED');
  assert.equal(observeObjectiveUnit({ ...completed, caseStatus: 'CANCELLED' })?.status, 'SKIPPED');
});

test('BLOCKED sin trabajo pendiente libera siguiente unidad; presupuesto diferido o lease activo no', () => {
  assert.equal(objectiveCaseInFlight({ unitStatus: 'BLOCKED', caseStatus: 'BLOCKED', hasPendingWork: false }), false);
  assert.equal(objectiveCaseInFlight({ unitStatus: 'BLOCKED', caseStatus: 'BLOCKED', hasPendingWork: true }), true);
  assert.equal(objectiveCaseInFlight({ unitStatus: 'QUEUED', caseStatus: 'QUEUED', hasPendingWork: true }), true);
  assert.equal(objectiveCaseInFlight({ unitStatus: 'NEEDS_REVIEW', caseStatus: 'RUNNING', hasPendingWork: true }), true);
  const service = readFileSync(new URL('../lib/company-os/continuous-objectives.ts', import.meta.url), 'utf8');
  assert.equal(service.match(/c.status NOT IN \(\$\{Prisma.join\(OBJECTIVE_SETTLED_CASE_STATUSES\)\}\)/g)?.length, 2);
});

// A narrow transaction double verifies callback boundaries; SQL locks/constraints are also checked below.
const goal = { id: 'goal-123456', version: 1, controlRevision: 0, ...input, status: 'ACTIVE', startsAt: now, endsAt: new Date('2026-10-03T04:00:00Z'),
  scanIntervalMinutes: 15, nextScanAt: now, createdBy: 'actor:test', createdAt: now, updatedAt: now,
  lastScanAt: null, sourcesObserved: 0, sourcesExcluded: 0, scanCursor: '', scanObserved: 0, scanExcluded: 0, scanDomains: [] };
const baseline = baselineObjectiveUnits(input, [])[0];
const unit = { id: 'unit-123456', goalId: goal.id, version: 1, ...baseline, caseId: null, status: 'PLANNED',
  resultSummary: null, resultEvidence: [], sourceResolved: false, verificationScope: 'ANALYSIS_ONLY', createdAt: now, updatedAt: now };
async function withFakeDb<T>(responses: unknown[], run: (calls: string[], tx: unknown) => Promise<T>) {
  const globalDb = globalThis as unknown as { companyOsV3Prisma?: unknown };
  const original = globalDb.companyOsV3Prisma;
  const calls: string[] = [];
  const tx = {
    $queryRaw: async (sql: { sql: string }) => { calls.push(sql.sql); assert.ok(responses.length, sql.sql); return responses.shift(); },
    $executeRaw: async (sql: { sql: string }) => { calls.push(sql.sql); return 1; },
  };
  globalDb.companyOsV3Prisma = { $transaction: async (fn: (tx: unknown) => Promise<T>, options?: { timeout: number }) => {
    if (options) assert.equal(options.timeout, 30_000); return fn(tx);
  } };
  try { return await run(calls, tx); } finally { globalDb.companyOsV3Prisma = original; }
}

test('materialización bloquea objetivo primero y callback comparte transacción con enlace/evento', async () => {
  await withFakeDb([[goal], [{ eligible: true }], [unit], [], [{ lastGeneratedCount: 1 }]], async (calls, tx) => {
    const result = await withContinuousObjectiveUnitClaim(unit.id, async (receivedTx, planned, definition) => {
      assert.equal(receivedTx, tx); assert.equal(planned.unitId, unit.id); assert.equal(definition.id, goal.id);
      return 'case-123456';
    });
    assert.equal(result.claimed, true);
    assert.match(calls[0], /CompanyOsContinuousObjective.*[\s\S]*FOR UPDATE/);
    assert.match(calls[2], /CompanyOsObjectiveUnit.*FOR UPDATE/);
    assert.ok(calls.some((sql) => sql.includes('UPDATE public."CompanyOsObjectiveUnit"')));
    assert.ok(calls.some((sql) => sql.includes('INSERT INTO public."CompanyOsObjectiveEvent"')));
  });
});

test('no llama creador con objetivo pausado, caso previo o unidad ya materializada', async () => {
  for (const responses of [[[goal], [{ eligible: false }]], [[goal], [{ eligible: true }], [unit], [{ id: 'other-unit' }]],
    [[goal], [{ eligible: true }], [{ ...unit, status: 'QUEUED', caseId: 'case-old' }]]]) {
    await withFakeDb(responses, async () => {
      const result = await withContinuousObjectiveUnitClaim(unit.id, async () => assert.fail('No debe crear otro caso'));
      assert.equal(result.claimed, false);
    });
  }
});

test('revalida fuente que se volvió activa; SKIPPED auditable sin ejecutar ni editar fuente', async () => {
  const planned = planObjectiveSource(source, input.projectAllowlist);
  assert.ok(!('excluded' in planned));
  await withFakeDb([[goal], [{ eligible: true }], [{ ...unit, ...planned }], [], [{ ...source, sourceStatus: 'ACTIVE' }]], async (calls) => {
    const result = await withContinuousObjectiveUnitClaim(unit.id, async () => assert.fail('Fuente activa excluida'));
    assert.equal(result.reason, 'SOURCE_CHANGED');
    assert.ok(calls.some((sql) => sql.includes("status='SKIPPED'")));
    assert.ok(!calls.some((sql) => /UPDATE public\."CompanyOsCodexTask"/.test(sql)));
  });
});

test('reintento CREATE devuelve objetivo existente sin insert ni nueva planificación', async () => {
  const normalized = validateContinuousObjectiveInput(input);
  const requestHash = objectiveHash({ action: 'CREATE', normalized: normalized.requestHash });
  await withFakeDb([[], [], [{ goalId: goal.id, requestHash }], [goal], [], []], async (calls) => {
    const result = await createContinuousObjective(input, 'admin-test');
    assert.equal(result.reused, true);
    assert.equal(result.objective.id, goal.id);
    assert.ok(!calls.some((sql) => /INSERT|UPDATE/.test(sql)));
  });
});

test('control rechaza revisión vieja sin actualizar ni alterar versión semántica', async () => {
  await withFakeDb([[], [{ ...goal, controlRevision: 2 }], []], async (calls) => {
    await assert.rejects(controlContinuousObjective({ objectiveId: goal.id, action: 'PAUSE', expectedVersion: 1,
      expectedControlRevision: 0, idempotencyKey: 'ui:continuous:control:1234' }, 'admin-test'), /objetivo cambió/);
    assert.ok(!calls.some((sql) => /UPDATE public/.test(sql)));
  });
});

test('cierre anticipado exige pausa, conserva historial y queda auditado', async () => {
  const paused = { ...goal, status: 'PAUSED' as const, controlRevision: 1 };
  const ended = { ...paused, status: 'EXPIRED' as const, controlRevision: 2, endsAt: now };
  await withFakeDb([[], [paused], [], [ended], [], []], async (calls) => {
    const result = await controlContinuousObjective({ objectiveId: goal.id, action: 'END', expectedVersion: 1,
      expectedControlRevision: 1, idempotencyKey: 'ui:continuous:end:1234' }, 'admin-test');
    assert.equal(result.objective.status, 'EXPIRED');
    assert.ok(calls.some((sql) => sql.includes("status=") && sql.includes("controlRevision")));
    assert.match(readFileSync(new URL('../lib/company-os/continuous-objectives.ts', import.meta.url), 'utf8'), /OBJECTIVE_ENDED/);
    assert.ok(!calls.some((sql) => /DELETE FROM/.test(sql)));
  });
  await withFakeDb([[], [goal], []], async () => {
    await assert.rejects(controlContinuousObjective({ objectiveId: goal.id, action: 'END', expectedVersion: 1,
      expectedControlRevision: 0, idempotencyKey: 'ui:continuous:end-active:1234' }, 'admin-test'), /estado/);
  });
});

test('sigue observando resultados de objetivos vencidos sin generar casos ni reactivarlos', async () => {
  const finishedUnit = { ...unit, status: 'QUEUED', caseId: 'case-123456', caseStatus: 'COMPLETED', hasPendingWork: false,
    resultMessageId: 'message-123456', resultPayload: { summary: 'Snapshot observado', confidence: 0.95, needsHumanDecision: false }, evidenceIds: ['evidence-123456'] };
  await withFakeDb([[{ ...goal, status: 'EXPIRED' }], [finishedUnit]], async (calls) => {
    const result = await planContinuousObjectiveUnits({ now });
    assert.equal(result.pendingUnits.length, 0);
    assert.equal(result.scannedObjectives, 0);
    assert.ok(calls.some((sql) => sql.includes('UPDATE public."CompanyOsObjectiveUnit"')));
    assert.ok(calls.some((sql) => sql.includes('UPDATE public."CompanyOsContinuousObjective"')));
  });
});

test('fallo del creador no alcanza enlace QUEUED ni evento de materialización', async () => {
  await withFakeDb([[goal], [{ eligible: true }], [unit], []], async (calls) => {
    await assert.rejects(withContinuousObjectiveUnitClaim(unit.id, async () => { throw new Error('rollback-test'); }), /rollback-test/);
    assert.ok(!calls.some((sql) => /UPDATE public|INSERT INTO/.test(sql)));
  });
});

test('migración fuerza RLS, niega roles amplios, protege evento y dedupe/una unidad en vuelo', () => {
  const migration = readFileSync(new URL('../../supabase/migrations/20260903020502_company_os_continuous_objectives.sql', import.meta.url), 'utf8');
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.%I FROM PUBLIC,anon,authenticated,service_role,company_os_reader/);
  assert.match(migration, /UNIQUE \("goalId",version,"sourceId",fingerprint\)/);
  assert.match(migration, /UNIQUE INDEX company_os_objective_one_queued/);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON public\."CompanyOsObjectiveEvent"/);
  assert.match(migration, /"sourceResolved" = false/);
  assert.match(migration, /FOREIGN KEY \("unitId","goalId"\)/);
  assert.ok(!/GRANT (?:INSERT|UPDATE|DELETE).*ON.*(?:Client|Transaction)/.test(migration));
});

test('migración agrega readback de reconciliación y dedupe durable por raíz', () => {
  const migration = readFileSync(new URL('../../supabase/migrations/20260904120000_company_os_continuous_reconciliation.sql', import.meta.url), 'utf8');
  assert.match(migration, /reconciliationStatus/);
  assert.match(migration, /lastGeneratedCount/);
  assert.match(migration, /zeroGenerationReason/);
  assert.match(migration, /CompanyOsObjectiveUnit_goal_version_root_key/);
  assert.match(migration, /ALTER COLUMN "rootKey" SET NOT NULL/);
  assert.match(migration, /No business table or second worker/);
});

test('migración externa conserva revisiones append-only, autoridad por fuente y RLS cerrado', () => {
  const migration = readFileSync(new URL('../../supabase/migrations/20260905183000_company_os_external_source_items.sql', import.meta.url), 'utf8');
  assert.match(migration, /UNIQUE \("sourceId","itemKey","revisionFingerprint"\)/);
  assert.match(migration, /External source item revision is immutable/);
  assert.match(migration, /GOOGLE_CONTACTS'[\s\S]*GOOGLE_USER_OAUTH_READONLY/);
  assert.match(migration, /CHATGPT_WORK'[\s\S]*AUTHORIZED_CHATGPT_WORK_EXPORT_V1/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE[\s\S]*service_role,company_os_reader/);
});

test('a igual prioridad reparte por gerente menos atendido y no por antigüedad de toda la cola General', () => {
  const service = readFileSync(new URL('../lib/company-os/continuous-objectives.ts', import.meta.url), 'utf8');
  assert.match(service, /ORDER BY priority,\s+COALESCE\(\(SELECT max\(prior\."updatedAt"\)/);
  assert.match(service, /prior\."ownerAgentId"=unit\."ownerAgentId" AND prior\."caseId" IS NOT NULL/);
  assert.match(service, /WHEN 'systems-manager-ai-v1' THEN 0 WHEN 'data-manager-ai-v1' THEN 1 ELSE 2 END/);
});
