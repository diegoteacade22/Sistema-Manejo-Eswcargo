import { createHash, createSign } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_URL = 'https://www.googleapis.com/drive/v3/files';
const SHEETS_URL = 'https://sheets.googleapis.com/v4/spreadsheets';
const PEOPLE_URL = 'https://people.googleapis.com/v1/people/me/connections';
const GOOGLE_SCOPE = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/contacts.readonly',
].join(' ');
const REQUEST_TIMEOUT_MS = 15_000;

function base64url(value) {
  return (Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)))
    .toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function safeStatus(error) {
  return String(error?.status || error?.code || 'CONNECTOR_ERROR').slice(0, 80);
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

function dependency(sourceId, status, detail, latencyMs, observedAt = new Date().toISOString()) {
  return { key: `external-${sourceId.toLowerCase().replaceAll('_', '-')}`, sourceId, status, detail: String(detail).slice(0, 500), latencyMs, observedAt };
}

function observationProof(value) {
  const evidenceHash = createHash('sha256').update(JSON.stringify(value)).digest('hex');
  return { snapshotId: `snapshot:${evidenceHash.slice(0, 32)}`, evidenceHash };
}

async function googleSnapshot(credentialsJson) {
  const credentials = await readServiceAccount(credentialsJson);
  if (!credentials) throw new Error('GOOGLE_SERVICE_ACCOUNT_INVALID');
  const token = await accessToken(credentials);
  const headers = { authorization: `Bearer ${token}` };
  const driveQuery = encodeURIComponent("trashed = false");
  const fields = encodeURIComponent('files(id,mimeType,name,modifiedTime)');
  const startedAt = Date.now();
  const files = await fetchJson(`${DRIVE_URL}?pageSize=25&orderBy=modifiedTime%20desc&q=${driveQuery}&fields=${fields}`, { headers });
  const allFiles = Array.isArray(files.files) ? files.files : [];
  const sheets = allFiles.filter((file) => file?.mimeType === 'application/vnd.google-apps.spreadsheet');
  const sheetFields = encodeURIComponent('files(id,mimeType,modifiedTime)');
  const sheetFiles = await fetchJson(`${DRIVE_URL}?pageSize=25&q=${encodeURIComponent("trashed = false and mimeType = 'application/vnd.google-apps.spreadsheet'")}&fields=${sheetFields}`, { headers });
  const firstSheetId = Array.isArray(sheetFiles.files) ? sheetFiles.files[0]?.id : null;
  const sheetMetadata = firstSheetId
    ? await fetchJson(`${SHEETS_URL}/${encodeURIComponent(firstSheetId)}?includeGridData=false&fields=spreadsheetId,sheets.properties`, { headers })
    : null;
  const peopleStartedAt = Date.now();
  const people = await fetchJson(`${PEOPLE_URL}?pageSize=1&personFields=metadata`, { headers });
  const peopleCount = Number.isSafeInteger(people.totalPeople) ? people.totalPeople : (Array.isArray(people.connections) ? people.connections.length : 0);
  const driveProof = observationProof({ files: allFiles.map(({ id, mimeType, modifiedTime }) => ({ id, mimeType, modifiedTime })), cursor: 'pageSize:25' });
  const sheetsProof = observationProof({ files: Array.isArray(sheetFiles.files) ? sheetFiles.files : [], metadata: sheetMetadata, cursor: 'pageSize:25' });
  const contactsProof = observationProof({ peopleCount, cursor: 'pageSize:1' });
  return [
    dependency('GOOGLE_DRIVE', 'HEALTHY', `read_only=true;snapshot_id=${driveProof.snapshotId};evidence_hash=${driveProof.evidenceHash};cursor=pageSize:25;files_sample=${allFiles.length};scope=drive.readonly`, Date.now() - startedAt),
    dependency('GOOGLE_SHEETS', 'HEALTHY', `read_only=true;snapshot_id=${sheetsProof.snapshotId};evidence_hash=${sheetsProof.evidenceHash};cursor=pageSize:25;spreadsheets_sample=${Array.isArray(sheetFiles.files) ? sheetFiles.files.length : sheets.length};metadata_read=${sheetMetadata ? 'true' : 'false'};scope=spreadsheets.readonly`, Date.now() - startedAt),
    dependency('GOOGLE_CONTACTS', 'HEALTHY', `read_only=true;snapshot_id=${contactsProof.snapshotId};evidence_hash=${contactsProof.evidenceHash};cursor=pageSize:1;people_count=${Math.max(0, peopleCount)};scope=contacts.readonly`, Date.now() - peopleStartedAt),
  ];
}

async function localChatgptWorkSnapshot() {
  const indexPath = join(homedir(), '.codex', 'session_index.jsonl');
  const sessionRoot = join(homedir(), '.codex', 'sessions');
  try {
    const index = await readFile(indexPath, 'utf8');
    const lines = index.split(/\r?\n/).filter(Boolean);
    const proof = observationProof({ indexHash: createHash('sha256').update(index).digest('hex'), entries: lines.length, cursor: `entries:${Math.min(lines.length, 120)}` });
    return dependency('CHATGPT_WORK', 'HEALTHY', `read_only=true;snapshot_id=${proof.snapshotId};evidence_hash=${proof.evidenceHash};cursor=entries:${Math.min(lines.length, 120)};local_export=index;entries=${Math.min(lines.length, 120)}`, 0);
  } catch (error) {
    return dependency('CHATGPT_WORK', 'UNAVAILABLE', `read_only=true;local_export=missing;code=${safeStatus(error)}`, 0);
  }
}

export async function probeExternalSources({ googleServiceAccountJson, now = () => new Date() } = {}) {
  const observedAt = now().toISOString();
  const results = [];
  if (googleServiceAccountJson) {
    try {
      results.push(...await googleSnapshot(googleServiceAccountJson));
    } catch (error) {
      const code = safeStatus(error);
      for (const sourceId of ['GOOGLE_DRIVE', 'GOOGLE_SHEETS', 'GOOGLE_CONTACTS']) {
        results.push(dependency(sourceId, 'UNAVAILABLE', `read_only=true;code=${code}`, 0, observedAt));
      }
    }
  } else {
    for (const sourceId of ['GOOGLE_DRIVE', 'GOOGLE_SHEETS', 'GOOGLE_CONTACTS']) {
      results.push(dependency(sourceId, 'UNAVAILABLE', 'read_only=true;credential_not_loaded', 0, observedAt));
    }
  }
  results.push(await localChatgptWorkSnapshot());
  return results.map((item) => ({ ...item, observedAt: item.observedAt || observedAt }));
}
