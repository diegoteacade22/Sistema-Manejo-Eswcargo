import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';

const SOURCES = ['GOOGLE_DRIVE', 'GOOGLE_SHEETS', 'GOOGLE_CONTACTS', 'CHATGPT_WORK'] as const;
type SourceId = typeof SOURCES[number];
const MAX_BATCH_BYTES = 128 * 1024;
const MAX_ITEMS_PER_SOURCE = 25;
const MAX_ITEMS_TOTAL = 100;
const MAX_NEW_REVISIONS_PER_SOURCE_HOUR = 100;
const SNAPSHOT_FRESH_MS = 30 * 60_000;
const FUTURE_TOLERANCE_MS = 5 * 60_000;

const AUTHORITY_BY_SOURCE: Record<SourceId, readonly string[]> = {
  GOOGLE_DRIVE: ['GOOGLE_SERVICE_ACCOUNT_READONLY', 'GOOGLE_USER_OAUTH_READONLY'],
  GOOGLE_SHEETS: ['GOOGLE_SERVICE_ACCOUNT_READONLY', 'GOOGLE_USER_OAUTH_READONLY'],
  GOOGLE_CONTACTS: ['GOOGLE_USER_OAUTH_READONLY', 'GOOGLE_DELEGATED_USER_READONLY'],
  CHATGPT_WORK: ['AUTHORIZED_CHATGPT_WORK_EXPORT_V1'],
};
const ITEM_KIND_BY_SOURCE: Record<SourceId, string> = {
  GOOGLE_DRIVE: 'FILE_METADATA',
  GOOGLE_SHEETS: 'SHEET_METADATA',
  GOOGLE_CONTACTS: 'CONTACT_METADATA',
  CHATGPT_WORK: 'THREAD_REQUEST',
};

export type ExternalSourceItem = {
  itemKey: string;
  providerRevisionHash: string;
  revisionFingerprint: string;
  itemKind: string;
  changeKind: string;
  sourceUpdatedAt: string | null;
};

export type ExternalSourceItemBatch = {
  schemaVersion: 1;
  sourceId: SourceId;
  status: 'HEALTHY';
  readOnly: true;
  authorityMode: string;
  principalRefHash: string;
  observedAt: string;
  capturedAt: string;
  snapshotId: string;
  evidenceHash: string;
  complete: boolean;
  cursorHash: string;
  items: ExternalSourceItem[];
};

export function externalSourceDependencyKey(sourceId: ExternalSourceItemBatch['sourceId']) {
  return `external-${sourceId.toLowerCase().replaceAll('_', '-')}`;
}

// This detail is derived only from a batch that passed parseBatch's exact-schema,
// authority and cryptographic checks. Keep its opaque hashes byte-for-byte stable:
// the free-text redactor can otherwise mistake a numeric hash run for a phone.
export function formatExternalSourceDependencyDetail(batch: ExternalSourceItemBatch) {
  return `read_only=true;items_schema=v1;items_count=${batch.items.length};snapshot_id=${batch.snapshotId};evidence_hash=${batch.evidenceHash};complete=${batch.complete};authority_mode=${batch.authorityMode};cursor_hash=${batch.cursorHash}`;
}

export class ExternalSourceItemError extends Error {
  readonly code: string;
  constructor(message: string, code = 'EXTERNAL_ITEM_INVALID') {
    super(message);
    this.name = 'ExternalSourceItemError';
    this.code = code;
  }
}

function sha(value: unknown) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function hex64(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function parseDate(value: unknown, now: Date, allowNull = false) {
  if (allowNull && value === null) return null;
  if (typeof value !== 'string') throw new ExternalSourceItemError('Timestamp externo inválido');
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
    throw new ExternalSourceItemError('Timestamp externo inválido');
  }
  return parsed.toISOString();
}

function parseItem(value: unknown, sourceId: SourceId, now: Date): ExternalSourceItem {
  if (!record(value) || !exactKeys(value, ['itemKey', 'providerRevisionHash', 'revisionFingerprint', 'itemKind', 'changeKind', 'sourceUpdatedAt'])
    || !hex64(value.itemKey) || !hex64(value.providerRevisionHash) || !hex64(value.revisionFingerprint)
    || value.itemKind !== ITEM_KIND_BY_SOURCE[sourceId]
    || !['CREATED', 'UPDATED', 'PENDING_REVIEW'].includes(String(value.changeKind))) {
    throw new ExternalSourceItemError('Ítem externo inválido');
  }
  if (sourceId === 'CHATGPT_WORK' && value.changeKind !== 'PENDING_REVIEW') throw new ExternalSourceItemError('Cambio ChatGPT inválido');
  const item: ExternalSourceItem = {
    itemKey: value.itemKey,
    providerRevisionHash: value.providerRevisionHash,
    itemKind: value.itemKind,
    changeKind: String(value.changeKind),
    sourceUpdatedAt: parseDate(value.sourceUpdatedAt, now, true),
    revisionFingerprint: value.revisionFingerprint,
  };
  const expected = sha({ sourceId, itemKey: item.itemKey, providerRevisionHash: item.providerRevisionHash,
    itemKind: item.itemKind, changeKind: item.changeKind, sourceUpdatedAt: item.sourceUpdatedAt });
  if (expected !== item.revisionFingerprint) throw new ExternalSourceItemError('Fingerprint de revisión inválido');
  return item;
}

function parseBatch(value: unknown, now: Date): ExternalSourceItemBatch {
  const keys = ['schemaVersion', 'sourceId', 'status', 'readOnly', 'authorityMode', 'principalRefHash', 'observedAt', 'capturedAt',
    'snapshotId', 'evidenceHash', 'complete', 'cursorHash', 'items'];
  if (!record(value) || !exactKeys(value, keys) || value.schemaVersion !== 1 || value.status !== 'HEALTHY' || value.readOnly !== true
    || !SOURCES.includes(value.sourceId as SourceId) || !hex64(value.principalRefHash) || !hex64(value.evidenceHash)
    || !hex64(value.cursorHash) || typeof value.complete !== 'boolean' || !Array.isArray(value.items)
    || value.items.length > MAX_ITEMS_PER_SOURCE) throw new ExternalSourceItemError('Batch externo inválido');
  const sourceId = value.sourceId as SourceId;
  if (typeof value.authorityMode !== 'string' || !AUTHORITY_BY_SOURCE[sourceId].includes(value.authorityMode)) {
    throw new ExternalSourceItemError('Autoridad externa inválida');
  }
  const observedAt = parseDate(value.observedAt, now)!;
  const capturedAt = parseDate(value.capturedAt, now)!;
  if (now.getTime() - new Date(capturedAt).getTime() > SNAPSHOT_FRESH_MS
    || Math.abs(new Date(observedAt).getTime() - new Date(capturedAt).getTime()) > FUTURE_TOLERANCE_MS) {
    throw new ExternalSourceItemError('Snapshot externo vencido');
  }
  const items = value.items.map((item) => parseItem(item, sourceId, now))
    .sort((left, right) => `${left.itemKey}:${left.revisionFingerprint}`.localeCompare(`${right.itemKey}:${right.revisionFingerprint}`));
  if (new Set(items.map((item) => `${item.itemKey}:${item.revisionFingerprint}`)).size !== items.length) {
    throw new ExternalSourceItemError('Batch externo duplicado');
  }
  const evidenceHash = sha(items);
  if (value.evidenceHash !== evidenceHash || value.snapshotId !== `snapshot:${evidenceHash.slice(0, 32)}`) {
    throw new ExternalSourceItemError('Evidencia externa inválida');
  }
  return {
    schemaVersion: 1, sourceId, status: 'HEALTHY', readOnly: true, authorityMode: value.authorityMode,
    principalRefHash: value.principalRefHash, observedAt, capturedAt, snapshotId: value.snapshotId,
    evidenceHash, complete: value.complete, cursorHash: value.cursorHash, items,
  };
}

export function parseRuntimeExternalSourceBatches(value: unknown, now = new Date()) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_BATCH_BYTES || value.length > SOURCES.length) {
    throw new ExternalSourceItemError('Payload externo inválido');
  }
  const batches = value.flatMap((entry) => record(entry) && entry.itemBatch !== undefined ? [parseBatch(entry.itemBatch, now)] : []);
  if (new Set(batches.map((batch) => batch.sourceId)).size !== batches.length
    || batches.reduce((sum, batch) => sum + batch.items.length, 0) > MAX_ITEMS_TOTAL) {
    throw new ExternalSourceItemError('Payload externo excede límites');
  }
  return batches;
}

export async function persistExternalSourceItems(
  tx: Prisma.TransactionClient,
  workerId: string,
  batches: readonly ExternalSourceItemBatch[],
  now = new Date(),
) {
  let inserted = 0;
  let refreshed = 0;
  for (const batch of batches) {
    await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`company-os-external-items:${workerId}:${batch.sourceId}`}))::text`);
    const identities = batch.items.map((item) => `${item.itemKey}:${item.revisionFingerprint}`);
    const existing = identities.length === 0 ? [] : await tx.$queryRaw<Array<{ identity: string }>>(Prisma.sql`
      SELECT "itemKey" || ':' || "revisionFingerprint" AS identity
      FROM public."CompanyOsExternalSourceItem"
      WHERE "sourceId"=${batch.sourceId}
        AND ("itemKey" || ':' || "revisionFingerprint") IN (${Prisma.join(identities)})
    `);
    const existingSet = new Set(existing.map((row) => row.identity));
    const newCount = identities.filter((identity) => !existingSet.has(identity)).length;
    const hourly = await tx.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      SELECT count(*)::integer AS count FROM public."CompanyOsExternalSourceItem"
      WHERE "sourceId"=${batch.sourceId} AND "createdAt">=date_trunc('hour',${now}::timestamptz)
    `);
    if ((hourly[0]?.count ?? 0) + newCount > MAX_NEW_REVISIONS_PER_SOURCE_HOUR) {
      throw new ExternalSourceItemError('Límite horario de revisiones externas excedido', 'EXTERNAL_ITEM_RATE_LIMIT');
    }
    for (const item of batch.items) {
      const rows = await tx.$queryRaw<Array<{ inserted: boolean }>>(Prisma.sql`
        INSERT INTO public."CompanyOsExternalSourceItem" (id,"sourceId","itemKey","providerRevisionHash","revisionFingerprint","itemKind","changeKind",
          "authorityMode","principalRefHash","snapshotId","snapshotEvidenceHash","sourceUpdatedAt","workerId","firstObservedAt","lastObservedAt")
        VALUES (${randomUUID()},${batch.sourceId},${item.itemKey},${item.providerRevisionHash},${item.revisionFingerprint},${item.itemKind},${item.changeKind},
          ${batch.authorityMode},${batch.principalRefHash},${batch.snapshotId},${batch.evidenceHash},${item.sourceUpdatedAt ? new Date(item.sourceUpdatedAt) : null},
          ${workerId},${new Date(batch.capturedAt)},${new Date(batch.capturedAt)})
        ON CONFLICT ("sourceId","itemKey","revisionFingerprint") DO UPDATE
          SET "lastObservedAt"=EXCLUDED."lastObservedAt","observationCount"=public."CompanyOsExternalSourceItem"."observationCount"+1,"updatedAt"=clock_timestamp()
          WHERE EXCLUDED."lastObservedAt">public."CompanyOsExternalSourceItem"."lastObservedAt"
        RETURNING (xmax = 0) AS inserted
      `);
      if (rows[0]?.inserted) inserted += 1;
      else if (rows.length > 0) refreshed += 1;
    }
  }
  return { inserted, refreshed };
}
