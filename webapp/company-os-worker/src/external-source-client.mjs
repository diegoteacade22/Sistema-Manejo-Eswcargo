import { createHash, createHmac, createSign } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { lstat, readFile } from 'node:fs/promises';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_URL = 'https://www.googleapis.com/drive/v3/files';
const SHEETS_URL = 'https://sheets.googleapis.com/v4/spreadsheets';
const GOOGLE_SCOPE = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
].join(' ');
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ITEMS_PER_SOURCE = 25;
const MAX_EXPORT_BYTES = 5 * 1024 * 1024;
const SNAPSHOT_FRESH_MS = 30 * 60_000;
const FUTURE_TOLERANCE_MS = 5 * 60_000;
const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';

function sha(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function base64url(value) {
  return (Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)))
    .toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function safeStatus(error) {
  return String(error?.status || error?.code || error?.message || 'CONNECTOR_ERROR')
    .replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 80);
}

function exactKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [...expected].sort().join('\0');
}

async function fetchJson(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetch(url, { ...options, redirect: 'error', signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(`HTTP_${response.status}`), { status: response.status });
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function readServiceAccount(json) {
  if (!json) return null;
  try {
    let candidate = json;
    if (!candidate.trim().startsWith('{') && /^[0-9a-f]+$/i.test(candidate.trim()) && candidate.trim().length % 2 === 0) {
      candidate = Buffer.from(candidate.trim(), 'hex').toString('utf8');
    }
    const parsed = JSON.parse(candidate);
    if (parsed && parsed.type === 'service_account' && typeof parsed.client_email === 'string'
      && typeof parsed.private_key === 'string') return parsed;
  } catch {}
  return null;
}

async function accessToken(credentials) {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64url({ alg: 'RS256', typ: 'JWT' })}.${base64url({
    iss: credentials.client_email,
    scope: GOOGLE_SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  })}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  const assertion = `${unsigned}.${base64url(signer.sign(credentials.private_key))}`;
  const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion });
  const token = await fetchJson(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (typeof token.access_token !== 'string' || !token.access_token) throw new Error('GOOGLE_TOKEN_MISSING');
  return token.access_token;
}

function dependency(sourceId, status, detail, latencyMs, observedAt = new Date().toISOString(), itemBatch = undefined) {
  return {
    key: `external-${sourceId.toLowerCase().replaceAll('_', '-')}`,
    sourceId,
    status,
    detail: String(detail).slice(0, 500),
    latencyMs,
    observedAt,
    ...(itemBatch ? { itemBatch } : {}),
  };
}

function itemKey(identitySecret, sourceId, providerId) {
  return createHmac('sha256', identitySecret).update(`external-item-v1\0${sourceId}\0${providerId}`).digest('hex');
}

function externalItem({ identitySecret, sourceId, providerId, providerRevision, itemKind, changeKind, sourceUpdatedAt }) {
  const providerRevisionHash = sha(String(providerRevision));
  const item = {
    itemKey: itemKey(identitySecret, sourceId, String(providerId)),
    providerRevisionHash,
    itemKind,
    changeKind,
    sourceUpdatedAt: sourceUpdatedAt || null,
  };
  return { ...item, revisionFingerprint: sha({ sourceId, ...item }) };
}

function itemBatch({ sourceId, authorityMode, principalRefHash, observedAt, complete, cursor, items }) {
  const sortedItems = [...items].slice(0, MAX_ITEMS_PER_SOURCE)
    .sort((left, right) => `${left.itemKey}:${left.revisionFingerprint}`.localeCompare(`${right.itemKey}:${right.revisionFingerprint}`));
  const evidenceHash = sha(sortedItems);
  return {
    schemaVersion: 1,
    sourceId,
    status: 'HEALTHY',
    readOnly: true,
    authorityMode,
    principalRefHash,
    observedAt,
    capturedAt: observedAt,
    snapshotId: `snapshot:${evidenceHash.slice(0, 32)}`,
    evidenceHash,
    complete,
    cursorHash: sha(cursor),
    items: sortedItems,
  };
}

function batchDetail(batch) {
  return `read_only=true;items_schema=v1;items_count=${batch.items.length};snapshot_id=${batch.snapshotId};evidence_hash=${batch.evidenceHash};complete=${batch.complete};authority_mode=${batch.authorityMode};cursor_hash=${batch.cursorHash}`;
}

async function googleSnapshots(credentialsJson, identitySecret, observedAt) {
  const credentials = await readServiceAccount(credentialsJson);
  if (!credentials) throw new Error('GOOGLE_SERVICE_ACCOUNT_INVALID');
  if (!identitySecret) throw new Error('EXTERNAL_IDENTITY_SECRET_MISSING');
  const token = await accessToken(credentials);
  const headers = { authorization: `Bearer ${token}` };
  const principalRefHash = sha(credentials.client_email);
  const startedAt = Date.now();
  const driveQuery = encodeURIComponent('trashed = false');
  const fields = encodeURIComponent('files(id,mimeType,modifiedTime,version)');
  const files = await fetchJson(`${DRIVE_URL}?pageSize=${MAX_ITEMS_PER_SOURCE}&orderBy=modifiedTime%20desc&q=${driveQuery}&fields=${fields}`, { headers });
  const allFiles = Array.isArray(files.files) ? files.files : [];
  const driveItems = allFiles.filter((file) => file?.id && file?.mimeType !== SHEET_MIME && file?.modifiedTime).map((file) => externalItem({
    identitySecret, sourceId: 'GOOGLE_DRIVE', providerId: file.id,
    providerRevision: `${file.version || ''}:${file.modifiedTime}:${file.mimeType || ''}`,
    itemKind: 'FILE_METADATA', changeKind: 'UPDATED', sourceUpdatedAt: file.modifiedTime,
  }));
  const sheetFields = encodeURIComponent('files(id,mimeType,modifiedTime,version)');
  const sheetFiles = await fetchJson(`${DRIVE_URL}?pageSize=${MAX_ITEMS_PER_SOURCE}&orderBy=modifiedTime%20desc&q=${encodeURIComponent(`trashed = false and mimeType = '${SHEET_MIME}'`)}&fields=${sheetFields}`, { headers });
  const spreadsheets = Array.isArray(sheetFiles.files) ? sheetFiles.files : [];
  const firstSheetId = spreadsheets[0]?.id;
  if (firstSheetId) {
    await fetchJson(`${SHEETS_URL}/${encodeURIComponent(firstSheetId)}?includeGridData=false&fields=spreadsheetId,sheets.properties.sheetId`, { headers });
  }
  const sheetItems = spreadsheets.filter((file) => file?.id && file?.modifiedTime).map((file) => externalItem({
    identitySecret, sourceId: 'GOOGLE_SHEETS', providerId: file.id,
    providerRevision: `${file.version || ''}:${file.modifiedTime}:${file.mimeType || ''}`,
    itemKind: 'SHEET_METADATA', changeKind: 'UPDATED', sourceUpdatedAt: file.modifiedTime,
  }));
  const driveBatch = itemBatch({ sourceId: 'GOOGLE_DRIVE', authorityMode: 'GOOGLE_SERVICE_ACCOUNT_READONLY', principalRefHash,
    observedAt, complete: allFiles.length < MAX_ITEMS_PER_SOURCE, cursor: `drive:${allFiles.length}`, items: driveItems });
  const sheetsBatch = itemBatch({ sourceId: 'GOOGLE_SHEETS', authorityMode: 'GOOGLE_SERVICE_ACCOUNT_READONLY', principalRefHash,
    observedAt, complete: spreadsheets.length < MAX_ITEMS_PER_SOURCE, cursor: `sheets:${spreadsheets.length}`, items: sheetItems });
  return [
    dependency('GOOGLE_DRIVE', 'HEALTHY', batchDetail(driveBatch), Date.now() - startedAt, observedAt, driveBatch),
    dependency('GOOGLE_SHEETS', 'HEALTHY', batchDetail(sheetsBatch), Date.now() - startedAt, observedAt, sheetsBatch),
    dependency('GOOGLE_CONTACTS', 'UNAVAILABLE', 'read_only=true;code=GOOGLE_USER_OAUTH_OR_DELEGATION_REQUIRED', 0, observedAt),
  ];
}

async function chatgptWorkSnapshot({ exportPath, allowedProjectIds, identitySecret, observedAt }) {
  const startedAt = Date.now();
  if (!identitySecret) return dependency('CHATGPT_WORK', 'UNAVAILABLE', 'read_only=true;code=EXTERNAL_IDENTITY_SECRET_MISSING', 0, observedAt);
  try {
    const metadata = await lstat(exportPath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_EXPORT_BYTES
      || (metadata.mode & 0o077) !== 0 || (typeof process.getuid === 'function' && metadata.uid !== process.getuid())) {
      throw new Error('CHATGPT_WORK_EXPORT_UNSAFE');
    }
    const parsed = JSON.parse(await readFile(exportPath, 'utf8'));
    const capturedAt = new Date(parsed?.exportedAt);
    const nowMs = new Date(observedAt).getTime();
    if (!exactKeys(parsed, ['schemaVersion', 'canonicalSource', 'principalRef', 'exportedAt', 'items'])
      || parsed?.schemaVersion !== 1 || parsed?.canonicalSource !== 'codex_app'
      || typeof parsed?.principalRef !== 'string' || parsed.principalRef.length < 3
      || !Array.isArray(parsed.items) || parsed.items.length > MAX_ITEMS_PER_SOURCE
      || Number.isNaN(capturedAt.getTime()) || capturedAt.getTime() > nowMs + FUTURE_TOLERANCE_MS
      || nowMs - capturedAt.getTime() > SNAPSHOT_FRESH_MS) throw new Error('CHATGPT_WORK_EXPORT_INVALID');
    const allowlist = new Set(allowedProjectIds);
    if (allowlist.size === 0) throw new Error('CHATGPT_WORK_PROJECT_ALLOWLIST_EMPTY');
    const items = parsed.items.map((candidate) => {
      if (!exactKeys(candidate, ['threadId', 'projectId', 'updatedAt', 'status']) || typeof candidate.threadId !== 'string'
        || !/^[A-Za-z0-9-]{16,128}$/.test(candidate.threadId)
        || typeof candidate.projectId !== 'string' || !allowlist.has(candidate.projectId)
        || candidate.status !== 'PENDING_REVIEW' || Number.isNaN(Date.parse(candidate.updatedAt))) {
        throw new Error('CHATGPT_WORK_ITEM_INVALID');
      }
      return externalItem({ identitySecret, sourceId: 'CHATGPT_WORK', providerId: candidate.threadId,
        providerRevision: candidate.updatedAt, itemKind: 'THREAD_REQUEST', changeKind: 'PENDING_REVIEW',
        sourceUpdatedAt: new Date(candidate.updatedAt).toISOString() });
    });
    const batch = itemBatch({ sourceId: 'CHATGPT_WORK', authorityMode: 'AUTHORIZED_CHATGPT_WORK_EXPORT_V1',
      principalRefHash: sha(parsed.principalRef), observedAt: capturedAt.toISOString(), complete: true,
      cursor: `chatgpt-work:${items.length}`, items });
    return dependency('CHATGPT_WORK', 'HEALTHY', batchDetail(batch), Date.now() - startedAt, capturedAt.toISOString(), batch);
  } catch (error) {
    return dependency('CHATGPT_WORK', 'UNAVAILABLE', `read_only=true;code=${safeStatus(error)}`, Date.now() - startedAt, observedAt);
  }
}

export async function probeExternalSources({
  googleServiceAccountJson,
  externalIdentitySecret,
  chatgptWorkExportPath = join(homedir(), '.company-os-runtime', 'bridges', 'chatgpt-work.json'),
  chatgptWorkProjectIds = [],
  now = () => new Date(),
} = {}) {
  const observedAt = now().toISOString();
  const results = [];
  if (googleServiceAccountJson) {
    try {
      results.push(...await googleSnapshots(googleServiceAccountJson, externalIdentitySecret, observedAt));
    } catch (error) {
      const code = safeStatus(error);
      for (const sourceId of ['GOOGLE_DRIVE', 'GOOGLE_SHEETS', 'GOOGLE_CONTACTS']) {
        results.push(dependency(sourceId, 'UNAVAILABLE', `read_only=true;code=${code}`, 0, observedAt));
      }
    }
  } else {
    for (const sourceId of ['GOOGLE_DRIVE', 'GOOGLE_SHEETS', 'GOOGLE_CONTACTS']) {
      results.push(dependency(sourceId, 'UNAVAILABLE', 'read_only=true;code=GOOGLE_CREDENTIAL_NOT_LOADED', 0, observedAt));
    }
  }
  results.push(await chatgptWorkSnapshot({ exportPath: chatgptWorkExportPath, allowedProjectIds: chatgptWorkProjectIds,
    identitySecret: externalIdentitySecret, observedAt }));
  return results;
}
