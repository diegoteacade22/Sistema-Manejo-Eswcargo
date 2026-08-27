#!/usr/bin/env node
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { closeSync, createReadStream, existsSync, openSync, readFileSync, readSync, readdirSync } from 'node:fs';
import { hostname, homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const CODEX_HOME = resolve(process.env.CODEX_HOME || join(homedir(), '.codex'));
const API_BASE = (process.env.COMPANY_OS_CODEX_INTAKE_URL || 'https://webapp-weld-psi.vercel.app').replace(/\/$/, '');
const SECRET = (process.env.COMPANY_OS_CODEX_INTAKE_SECRET || '').trim();
const SOURCE_HOST = (process.env.COMPANY_OS_CODEX_SOURCE_HOST || hostname()).replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 120);
const WORKER_ID = (process.env.COMPANY_OS_CODEX_WORKER_ID || 'codex-intake-ai-v1').trim();
const ENDPOINT = '/api/company-os/codex/v1/intake';
const MAX_TASKS = Math.min(2_000, Math.max(1, Number(process.env.COMPANY_OS_CODEX_MAX_TASKS) || 2_000));
const DRY_RUN = process.env.COMPANY_OS_CODEX_DRY_RUN === '1';

if (!SECRET && !DRY_RUN) throw new Error('COMPANY_OS_CODEX_INTAKE_SECRET_REQUIRED');

function jsonLines(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function walkJsonl(root, output = new Map()) {
  if (!existsSync(root)) return output;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) walkJsonl(path, output);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      const id = entry.name.match(/([0-9a-f]{8}-[0-9a-f-]{27,})\.jsonl$/i)?.[1];
      if (id) output.set(id, path);
    }
  }
  return output;
}

function canonicalProjects() {
  const registryPath = join(CODEX_HOME, 'project-routing', 'canonical-projects.json');
  if (!existsSync(registryPath)) return [];
  try {
    const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
    return (registry.canonical_projects || []).flatMap((project) =>
      (project.local_roots || []).map((root) => ({ name: String(project.name), root: resolve(String(root)) }))
    ).sort((a, b) => b.root.length - a.root.length);
  } catch { return []; }
}

function projectName(cwd, projects) {
  const normalized = typeof cwd === 'string' && cwd ? resolve(cwd) : '';
  const canonical = projects.find((project) => normalized === project.root || normalized.startsWith(`${project.root}/`));
  if (canonical) return canonical.name.slice(0, 160);
  if (!normalized) return 'Sin proyecto asignado';
  const leaf = basename(normalized);
  return (leaf || 'Sin proyecto asignado').slice(0, 160);
}

function category(title, project) {
  const value = `${title} ${project}`.toLowerCase();
  if (/monitor|resumen diario|auditor[ií]a recurrente/.test(value)) return 'MONITOR';
  if (/oferta|precio|lista|compras|producto|stock|iphone|ventas/.test(value)) return 'COMMERCIAL';
  if (/finanza|banco|cash|pago|gasto|ingreso|tax/.test(value)) return 'FINANCE';
  if (/cliente|crm|contacto|whatsapp|wasa/.test(value)) return 'CUSTOMERS';
  if (/eswcargo|orden|carga|shipment|operaci[oó]n/.test(value)) return 'OPERATIONS';
  if (/codex|agente|sistema|deploy|vercel|github|sync|arquitectura/.test(value)) return 'SYSTEMS';
  if (/personal|m[uú]sica|salud|agenda/.test(value)) return 'PERSONAL';
  return 'GENERAL';
}

function classify({ title, lastStartedAt, lastCompletedAt, lastFinalText, updatedAt, archived }) {
  if (archived) return { humanStatus: 'DISCARDED', sourceStatus: 'ARCHIVED', autonomyLevel: 'A0', nextAction: 'Conservar como historial; no reactivar automáticamente.' };
  const lowerTitle = title.toLowerCase();
  const finalText = lastFinalText.toLowerCase();
  const started = lastStartedAt ? Date.parse(lastStartedAt) : 0;
  const completed = lastCompletedAt ? Date.parse(lastCompletedAt) : 0;
  const recent = Date.now() - Math.max(started, Date.parse(updatedAt)) < 2 * 60 * 60_000;
  if (/monitor|resumen diario|seguimiento|cada d[ií]a|semanal/.test(lowerTitle)) {
    return { humanStatus: 'MONITORING', sourceStatus: 'IDLE', autonomyLevel: 'A0', nextAction: 'Seguir controlando y mostrar sólo cambios que requieran acción.' };
  }
  if (started > completed && recent) {
    return { humanStatus: 'IN_PROGRESS', sourceStatus: 'ACTIVE', autonomyLevel: 'A1', nextAction: 'Dejar que el agente termine y verificar el resultado.' };
  }
  if (started > completed) {
    return { humanStatus: 'PENDING', sourceStatus: 'IDLE', autonomyLevel: 'A1', nextAction: 'Retomar la tarea desde el último punto y cerrar un resultado verificable.' };
  }
  if (/otp|contraseñ|credencial|autorizaci[oó]n|aprobaci[oó]n|necesito que|eleg[ií]|confirm[aá]|acci[oó]n tuya|diego debe/.test(finalText)) {
    return { humanStatus: 'NEEDS_DIEGO', sourceStatus: 'IDLE', autonomyLevel: 'HUMAN', attentionReason: 'Hace falta una decisión, autorización o dato de Diego.', nextAction: 'Abrir la tarea y responder el pedido concreto para destrabarla.' };
  }
  if (/bloquead|sin acceso|access denied|permission denied|falta evento|depende de|no disponible|esperando proveedor/.test(finalText)) {
    return { humanStatus: 'BLOCKED', sourceStatus: 'IDLE', autonomyLevel: 'A0', attentionReason: 'La tarea depende de un acceso, proveedor o evento externo.', nextAction: 'Revisar el bloqueo indicado y asignar el responsable de destrabe.' };
  }
  if (completed >= started && completed > 0 && /verificad|pr #|pull request|commit|tests? (ok|passed)|readback|resultado/.test(finalText)) {
    return { humanStatus: 'READY_REVIEW', sourceStatus: 'IDLE', autonomyLevel: 'A0', nextAction: 'Revisar la evidencia y marcar como realizada si el resultado es correcto.' };
  }
  return { humanStatus: 'UNREVIEWED', sourceStatus: 'NOT_LOADED', autonomyLevel: 'A0', nextAction: 'Auditar qué quedó pendiente antes de decidir si el agente puede retomarla.' };
}

async function inspectRollout(path) {
  const stream = createReadStream(path, { encoding: 'utf8' });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let meta = {};
  let lastStartedAt = null;
  let lastCompletedAt = null;
  let lastFinalText = '';
  for await (const line of lines) {
    let item;
    try { item = JSON.parse(line); } catch { continue; }
    if (item.type === 'session_meta') meta = item.payload || meta;
    const payload = item.payload || {};
    if (item.type === 'event_msg' && payload.type === 'task_started') lastStartedAt = eventTimestamp(payload.started_at, item.timestamp) || lastStartedAt;
    if (item.type === 'event_msg' && payload.type === 'task_complete') {
      lastCompletedAt = eventTimestamp(payload.completed_at, item.timestamp) || lastCompletedAt;
      if (typeof payload.last_agent_message === 'string') lastFinalText = payload.last_agent_message.slice(-4_000);
    }
    if (item.type === 'response_item' && payload.type === 'message' && payload.role === 'assistant' && payload.phase === 'final_answer') {
      const parts = Array.isArray(payload.content) ? payload.content : [];
      lastFinalText = parts.map((part) => typeof part?.text === 'string' ? part.text : '').join(' ').slice(-4_000);
    }
  }
  return { meta, lastStartedAt, lastCompletedAt, lastFinalText };
}

function eventTimestamp(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value * 1_000).toISOString();
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && value.trim()) return new Date(numeric * 1_000).toISOString();
    if (!Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  }
  return typeof fallback === 'string' && !Number.isNaN(Date.parse(fallback)) ? new Date(fallback).toISOString() : null;
}

function rolloutMeta(path) {
  const descriptor = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(64 * 1024);
    const bytes = readSync(descriptor, buffer, 0, buffer.length, 0);
    const firstLine = buffer.subarray(0, bytes).toString('utf8').split('\n', 1)[0];
    const item = JSON.parse(firstLine);
    return item?.type === 'session_meta' && item.payload && typeof item.payload === 'object' ? item.payload : {};
  } catch { return {}; }
  finally { closeSync(descriptor); }
}

function sha(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function collect() {
  const index = jsonLines(join(CODEX_HOME, 'session_index.jsonl'));
  const currentFiles = walkJsonl(join(CODEX_HOME, 'sessions'));
  const archivedFiles = walkJsonl(join(CODEX_HOME, 'archived_sessions'));
  const projects = canonicalProjects();
  const latestById = new Map();
  for (const row of index) if (row?.id && row?.updated_at) latestById.set(String(row.id), row);
  const rows = [...latestById.values()].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).slice(0, MAX_TASKS);
  const tasks = [];
  for (const row of rows) {
    const threadId = String(row.id);
    const path = currentFiles.get(threadId) || archivedFiles.get(threadId);
    if (!path) continue;
    const header = rolloutMeta(path);
    if (header.parent_thread_id || header.agent_path || header.forked_from_id) continue;
    const inspected = await inspectRollout(path);
    const title = String(row.thread_name || 'Tarea Codex sin título').replace(/\s+/g, ' ').trim().slice(0, 240);
    const project = projectName(inspected.meta.cwd, projects);
    const updatedAt = String(row.updated_at);
    const archived = archivedFiles.has(threadId);
    const state = classify({ title, ...inspected, updatedAt, archived });
    const task = {
      threadId,
      title,
      projectName: project,
      category: category(title, project),
      ...state,
      priority: state.humanStatus === 'NEEDS_DIEGO' ? 1 : state.humanStatus === 'BLOCKED' ? 2 : state.humanStatus === 'IN_PROGRESS' ? 2 : 3,
      sourceUpdatedAt: updatedAt,
      lastStartedAt: inspected.lastStartedAt,
      lastCompletedAt: inspected.lastCompletedAt,
      archived,
    };
    tasks.push({ ...task, fingerprint: sha(task) });
  }
  return tasks;
}

function signedHeaders(rawBody) {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = randomBytes(24).toString('base64url');
  const signature = createHmac('sha256', SECRET).update(`${WORKER_ID}.${nonce}.${timestamp}.${rawBody}`).digest('hex');
  return {
    'content-type': 'application/json',
    'x-company-os-worker-id': WORKER_ID,
    'x-company-os-nonce': nonce,
    'x-company-os-timestamp': String(timestamp),
    'x-company-os-signature': `sha256=${signature}`,
    'x-company-os-signature-version': 'v2',
  };
}

async function postChunk(payload) {
  const rawBody = JSON.stringify({ ...payload, workerId: WORKER_ID, instanceId: `${SOURCE_HOST}:${process.pid}` });
  const response = await fetch(`${API_BASE}${ENDPOINT}`, { method: 'POST', headers: signedHeaders(rawBody), body: rawBody, redirect: 'error' });
  if (!response.ok) throw new Error(`CODEX_INTAKE_HTTP_${response.status}`);
  return response.json();
}

const observedAt = new Date().toISOString();
const scanId = `${observedAt.replace(/[^0-9]/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
const tasks = await collect();
if (DRY_RUN) {
  const statuses = Object.fromEntries([...new Set(tasks.map((task) => task.humanStatus))].sort().map((status) => [status, tasks.filter((task) => task.humanStatus === status).length]));
  process.stdout.write(JSON.stringify({ ok: true, dryRun: true, sourceHost: SOURCE_HOST, observedCount: tasks.length, statuses }) + '\n');
  process.exit(0);
}
let changedCount = 0;
if (tasks.length === 0) {
  await postChunk({ sourceHost: SOURCE_HOST, scanId, observedAt, tasks: [], finalChunk: true, observedCount: 0, changedBefore: 0 });
}
for (let offset = 0; offset < tasks.length; offset += 100) {
  const chunk = tasks.slice(offset, offset + 100);
  const finalChunk = offset + chunk.length >= tasks.length;
  const result = await postChunk({ sourceHost: SOURCE_HOST, scanId, observedAt, tasks: chunk, finalChunk, observedCount: tasks.length, changedBefore: changedCount });
  changedCount += Number(result.changedCount || 0);
}
process.stdout.write(JSON.stringify({ ok: true, sourceHost: SOURCE_HOST, observedCount: tasks.length, changedCount, scanId }) + '\n');
