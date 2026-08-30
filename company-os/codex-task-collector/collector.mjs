#!/usr/bin/env node
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { closeSync, createReadStream, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { hostname, homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const CODEX_HOME = resolve(process.env.CODEX_HOME || join(homedir(), '.codex'));
const TRUSTED_API_ORIGIN = 'https://webapp-weld-psi.vercel.app';
const requestedApiUrl = new URL(process.env.COMPANY_OS_CODEX_INTAKE_URL || TRUSTED_API_ORIGIN);
if (requestedApiUrl.origin !== TRUSTED_API_ORIGIN || !['', '/'].includes(requestedApiUrl.pathname) || requestedApiUrl.search || requestedApiUrl.hash) {
  throw new Error('COMPANY_OS_CODEX_INTAKE_URL_NOT_TRUSTED');
}
const API_BASE = requestedApiUrl.origin;
const SECRET = (process.env.COMPANY_OS_CODEX_INTAKE_SECRET || '').trim();
delete process.env.COMPANY_OS_CODEX_INTAKE_SECRET;
const SOURCE_HOST = (process.env.COMPANY_OS_CODEX_SOURCE_HOST || hostname()).replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 120);
const WORKER_ID = (process.env.COMPANY_OS_CODEX_WORKER_ID || 'codex-intake-ai-v1').trim();
const INSTANCE_ID = `${SOURCE_HOST}:codex-auto-resume-v1`;
const STATE_DIR = resolve(process.env.COMPANY_OS_CODEX_COLLECTOR_STATE_DIR || join(homedir(), '.company-os-codex-collector'));
const START_GATE_PATH = process.env.COMPANY_OS_CODEX_START_GATE ? resolve(process.env.COMPANY_OS_CODEX_START_GATE) : null;
const START_GATE_TOKEN = process.env.COMPANY_OS_CODEX_START_TOKEN || null;
delete process.env.COMPANY_OS_CODEX_START_GATE;
delete process.env.COMPANY_OS_CODEX_START_TOKEN;
const CLAIM_STATE_PATH = join(STATE_DIR, 'dispatch-state.json');
const QUARANTINE_MARKER_PATH = join(STATE_DIR, 'dispatch-state.quarantined');
const INSTALL_ID = (process.env.COMPANY_OS_CODEX_INSTALL_ID || 'manual').replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 120);
const ENDPOINT = '/api/company-os/codex/v1/intake';
const DISPATCH_ENDPOINT = '/api/company-os/codex/v1/dispatch';
const MAX_TASKS = Math.min(2_000, Math.max(1, Number(process.env.COMPANY_OS_CODEX_MAX_TASKS) || 2_000));
const DRY_RUN = process.env.COMPANY_OS_CODEX_DRY_RUN === '1';
const AUTO_RESUME = process.env.COMPANY_OS_CODEX_AUTO_RESUME === '1';
const CODEX_BIN = resolve(process.env.COMPANY_OS_CODEX_BIN || '/opt/homebrew/bin/codex');
const AUTO_RESUME_TIMEOUT_MS = Math.min(3_600_000, Math.max(60_000, Number(process.env.COMPANY_OS_CODEX_AUTO_RESUME_TIMEOUT_MS) || 2_700_000));
const AUTO_RESUME_MAX_AGE_MS = Math.min(7 * 86_400_000, Math.max(2 * 60 * 60_000, Number(process.env.COMPANY_OS_CODEX_AUTO_RESUME_MAX_AGE_MS) || 3 * 86_400_000));
const HTTP_TIMEOUT_MS = Math.min(60_000, Math.max(5_000, Number(process.env.COMPANY_OS_CODEX_HTTP_TIMEOUT_MS) || 30_000));
const UNASSIGNED_PROJECT = 'SIN PROYECTO ASIGNADO';
const CLAIMED_REASONS = new Set(['APPROVED_TASK_CLAIMED', 'APPROVED_TASK_CLAIM_REPLAYED']);
const UNCLAIMED_REASONS = new Set(['NO_APPROVED_TASK', 'DISPATCH_ALREADY_ACTIVE', 'STALE_DISPATCH_BLOCKED', 'CLAIM_SOURCE_CHANGED', 'CLAIM_ALREADY_CONSUMED']);
const AUTO_RESUME_PROMPT = [
  'Continuá esta tarea desde el punto pendiente y cerrá un resultado verificable dentro del alcance original.',
  'Aplicá sólo acciones reversibles y ya autorizadas en el hilo.',
  'Tomá por tu cuenta las decisiones operativas reversibles que no cambien el objetivo y agotá hasta tres alternativas o reintentos seguros antes de detenerte.',
  'No pidas confirmación para pasos rutinarios, diagnósticos, ediciones acotadas, pruebas ni readbacks comprendidos en el pedido original.',
  'No envíes, publiques, borres, migres ni cambies producción o servicios externos sin autorización explícita en el hilo.',
  'Si hace falta una decisión, credencial, OTP, CAPTCHA, acción física o un tercero, no improvises: explicá el bloqueo concreto.',
  'No reinicies trabajo que ya esté terminado y verificá por readback antes de cerrar.',
  'La última línea debe ser exactamente AUTONOMY_RESULT: COMPLETED si el objetivo quedó verificado, AUTONOMY_RESULT: NEEDS_USER si sólo Diego puede destrabarlo, o AUTONOMY_RESULT: BLOCKED_EXTERNAL si depende de un tercero o servicio externo.',
].join(' ');

if (!SECRET && !DRY_RUN) throw new Error('COMPANY_OS_CODEX_INTAKE_SECRET_REQUIRED');

async function waitForStartGate() {
  if (!START_GATE_PATH && !START_GATE_TOKEN) return;
  if (!START_GATE_PATH || !START_GATE_TOKEN
    || resolve(START_GATE_PATH, '..') !== STATE_DIR
    || !/^start-gate\.[A-Za-z0-9-]{20,80}$/.test(basename(START_GATE_PATH))
    || !/^[A-Za-z0-9-]{20,80}$/.test(START_GATE_TOKEN)) {
    throw new Error('COLLECTOR_START_GATE_INVALID');
  }
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (existsSync(START_GATE_PATH)) {
      const info = lstatSync(START_GATE_PATH);
      const stat = statSync(START_GATE_PATH);
      if (!info.isFile() || info.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o600
        || readFileSync(START_GATE_PATH, 'utf8').trim() !== START_GATE_TOKEN) {
        throw new Error('COLLECTOR_START_GATE_INVALID');
      }
      unlinkSync(START_GATE_PATH);
      const directory = openSync(STATE_DIR, 'r');
      try { fsyncSync(directory); } finally { closeSync(directory); }
      return;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error('COLLECTOR_START_GATE_TIMEOUT');
}

await waitForStartGate();

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

function nativeCodexProjects() {
  const statePath = join(CODEX_HOME, '.codex-global-state.json');
  if (!existsSync(statePath)) throw new Error('CODEX_NATIVE_PROJECT_CATALOG_REQUIRED');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  const localProjects = state?.['local-projects'];
  if (!localProjects || typeof localProjects !== 'object' || Array.isArray(localProjects)) {
    throw new Error('CODEX_NATIVE_PROJECT_CATALOG_INVALID');
  }
  const projects = Object.values(localProjects).flatMap((project) => {
    const projectId = typeof project?.id === 'string' ? project.id.trim() : '';
    const name = typeof project?.name === 'string' ? project.name.trim() : '';
    const roots = Array.isArray(project?.rootPaths) ? project.rootPaths : [];
    const canonicalName = name.length > 0
      && name.length <= 160
      && name === name.toLocaleUpperCase('es-US')
      && !/[-–—]/.test(name);
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(projectId) || !canonicalName || roots.length === 0) return [];
    return roots.flatMap((root) => typeof root === 'string' && root.trim()
      ? [{ projectId, name, root: resolve(root) }]
      : []);
  }).sort((a, b) => b.root.length - a.root.length);
  if (!projects.length) throw new Error('CODEX_NATIVE_PROJECT_CATALOG_EMPTY');
  return projects;
}

function projectName(cwd, projects) {
  const normalized = typeof cwd === 'string' && cwd ? resolve(cwd) : '';
  const canonical = projects.find((project) => normalized === project.root || normalized.startsWith(`${project.root}/`));
  if (canonical) return canonical.name.slice(0, 160);
  return UNASSIGNED_PROJECT;
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

function finalAutonomyResult(text) {
  const finalLine = text.trimEnd().split(/\r?\n/).at(-1)?.trim() || '';
  if (finalLine === 'AUTONOMY_RESULT: COMPLETED') return 'COMPLETED';
  if (finalLine === 'AUTONOMY_RESULT: NEEDS_USER') return 'NEEDS_USER';
  if (finalLine === 'AUTONOMY_RESULT: BLOCKED_EXTERNAL') return 'BLOCKED_EXTERNAL';
  return null;
}

function classify({ title, lastStartedAt, lastCompletedAt, lastFinalAt, lastUserAt, lastFinalText, updatedAt, archived }) {
  if (archived) return { humanStatus: 'DISCARDED', sourceStatus: 'ARCHIVED', autonomyLevel: 'A0', nextAction: 'Conservar como historial; no reactivar automáticamente.' };
  const lowerTitle = title.toLowerCase();
  const finalText = lastFinalText.toLowerCase();
  const started = lastStartedAt ? Date.parse(lastStartedAt) : 0;
  const completed = lastCompletedAt ? Date.parse(lastCompletedAt) : 0;
  const finalAt = lastFinalAt ? Date.parse(lastFinalAt) : 0;
  const userAt = lastUserAt ? Date.parse(lastUserAt) : 0;
  const agentFinalIsLatest = finalAt >= userAt;
  const autonomyResult = agentFinalIsLatest ? finalAutonomyResult(lastFinalText) : null;
  const recent = Date.now() - Math.max(started, Date.parse(updatedAt)) < 2 * 60 * 60_000;
  const eligibleForAutonomousResume = started > completed
    && Date.now() - Math.max(started, Date.parse(updatedAt)) <= AUTO_RESUME_MAX_AGE_MS;
  if (/monitor|resumen diario|seguimiento|cada d[ií]a|semanal/.test(lowerTitle)) {
    return { humanStatus: 'MONITORING', sourceStatus: 'IDLE', autonomyLevel: 'A0', nextAction: 'Seguir controlando y mostrar sólo cambios que requieran acción.' };
  }
  if (started > completed && recent) {
    return { humanStatus: 'IN_PROGRESS', sourceStatus: 'ACTIVE', autonomyLevel: 'A1', nextAction: 'Dejar que el agente termine y verificar el resultado.' };
  }
  if (autonomyResult === 'NEEDS_USER') {
    return { humanStatus: 'NEEDS_DIEGO', sourceStatus: 'IDLE', autonomyLevel: 'HUMAN', attentionReason: 'Sólo Diego puede aportar el permiso, credencial o decisión faltante.', nextAction: 'Abrir la tarea únicamente cuando quieras resolver el bloqueo no delegable.' };
  }
  if (autonomyResult === 'BLOCKED_EXTERNAL') {
    return { humanStatus: 'BLOCKED', sourceStatus: 'IDLE', autonomyLevel: 'A0', attentionReason: 'La tarea depende de un tercero o servicio externo.', nextAction: 'Mantenerla en espera hasta que cambie la dependencia externa.' };
  }
  if (autonomyResult === 'COMPLETED' && completed >= started && completed > 0) {
    return { humanStatus: 'READY_REVIEW', sourceStatus: 'IDLE', autonomyLevel: 'A1', nextAction: 'Cierre automático tras verificar el reporte durable de ejecución.' };
  }
  if (agentFinalIsLatest && /otp|contraseñ|credencial|autorizaci[oó]n|aprobaci[oó]n|necesito que|eleg[ií]|confirm[aá]|acci[oó]n tuya|diego debe/.test(finalText)) {
    return { humanStatus: 'NEEDS_DIEGO', sourceStatus: 'IDLE', autonomyLevel: 'HUMAN', attentionReason: 'Hace falta una decisión, autorización o dato de Diego.', nextAction: 'Abrir la tarea y responder el pedido concreto para destrabarla.' };
  }
  if (agentFinalIsLatest && /bloquead|sin acceso|access denied|permission denied|falta evento|depende de|no disponible|esperando proveedor/.test(finalText)) {
    return { humanStatus: 'BLOCKED', sourceStatus: 'IDLE', autonomyLevel: 'A0', attentionReason: 'La tarea depende de un acceso, proveedor o evento externo.', nextAction: 'Revisar el bloqueo indicado y asignar el responsable de destrabe.' };
  }
  if (eligibleForAutonomousResume) {
    return { humanStatus: 'PENDING', sourceStatus: 'IDLE', autonomyLevel: 'A1', nextAction: 'El agente la reanudará automáticamente, sin pedir confirmación para pasos rutinarios.' };
  }
  if (started > completed) {
    return { humanStatus: 'UNREVIEWED', sourceStatus: 'IDLE', autonomyLevel: 'A0', nextAction: 'Auditar qué quedó pendiente y moverla a “Para el agente” sólo si puede retomarse sin una decisión externa.' };
  }
  if (agentFinalIsLatest && completed >= started && completed > 0 && /verificad|pr #|pull request|commit|tests? (ok|passed)|readback|resultado/.test(finalText)) {
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
  let lastFinalAt = null;
  let lastUserAt = null;
  let lastFinalText = '';
  for await (const line of lines) {
    let item;
    try { item = JSON.parse(line); } catch { continue; }
    if (item.type === 'session_meta') meta = item.payload || meta;
    const payload = item.payload || {};
    if (item.type === 'event_msg' && payload.type === 'task_started') lastStartedAt = eventTimestamp(payload.started_at, item.timestamp) || lastStartedAt;
    if (item.type === 'event_msg' && payload.type === 'task_complete') {
      lastCompletedAt = eventTimestamp(payload.completed_at, item.timestamp) || lastCompletedAt;
      if (typeof payload.last_agent_message === 'string') {
        lastFinalText = payload.last_agent_message.slice(-4_000);
        lastFinalAt = eventTimestamp(payload.completed_at, item.timestamp) || lastFinalAt;
      }
    }
    if (item.type === 'response_item' && payload.type === 'message' && payload.role === 'assistant' && payload.phase === 'final_answer') {
      const parts = Array.isArray(payload.content) ? payload.content : [];
      lastFinalText = parts.map((part) => typeof part?.text === 'string' ? part.text : '').join(' ').slice(-4_000);
      lastFinalAt = eventTimestamp(item.timestamp, item.timestamp) || lastFinalAt;
    }
    if (item.type === 'response_item' && payload.type === 'message' && payload.role === 'user') {
      lastUserAt = eventTimestamp(item.timestamp, item.timestamp) || lastUserAt;
    }
  }
  return { meta, lastStartedAt, lastCompletedAt, lastFinalAt, lastUserAt, lastFinalText };
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

async function collect(projects = nativeCodexProjects()) {
  const index = jsonLines(join(CODEX_HOME, 'session_index.jsonl'));
  const currentFiles = walkJsonl(join(CODEX_HOME, 'sessions'));
  const archivedFiles = walkJsonl(join(CODEX_HOME, 'archived_sessions'));
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

async function signedPost(endpoint, payload, attempts = 2) {
  const rawBody = JSON.stringify({ ...payload, workerId: WORKER_ID, instanceId: INSTANCE_ID });
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST', headers: signedHeaders(rawBody), body: rawBody, redirect: 'error', signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`CODEX_INTAKE_HTTP_${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolveWait) => setTimeout(resolveWait, 250 * attempt));
    }
  }
  throw lastError;
}

async function postChunk(payload) {
  return signedPost(ENDPOINT, payload);
}

async function projectInventory() {
  const observedAt = new Date().toISOString();
  const scanId = `${AUTO_RESUME ? 'auto' : 'inventory'}-${observedAt.replace(/[^0-9]/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
  const projects = nativeCodexProjects();
  const tasks = await collect(projects);
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
  return { tasks, changedCount, scanId };
}

function sessionCwd(threadId) {
  const currentFiles = walkJsonl(join(CODEX_HOME, 'sessions'));
  const archivedFiles = walkJsonl(join(CODEX_HOME, 'archived_sessions'));
  const path = currentFiles.get(threadId) || archivedFiles.get(threadId);
  const rawCwd = path ? rolloutMeta(path).cwd : null;
  if (typeof rawCwd !== 'string' || !rawCwd.trim() || !existsSync(rawCwd)) return null;
  try {
    const cwd = realpathSync(rawCwd);
    const userRoot = realpathSync(homedir());
    const blockedRoots = [CODEX_HOME, join(userRoot, '.ssh'), join(userRoot, 'Library')]
      .flatMap((root) => {
        try { return existsSync(root) ? [realpathSync(root)] : []; } catch { return []; }
      });
    const allowedRoots = nativeCodexProjects().flatMap((project) => {
      try {
        if (!existsSync(project.root)) return [];
        const root = realpathSync(project.root);
        const insideHome = root !== userRoot && root.startsWith(`${userRoot}/`);
        const blocked = blockedRoots.some((blockedRoot) => root === blockedRoot || root.startsWith(`${blockedRoot}/`));
        return insideHome && !blocked ? [root] : [];
      } catch { return []; }
    });
    return allowedRoots.some((root) => cwd === root || cwd.startsWith(`${root}/`)) ? cwd : null;
  } catch {
    return null;
  }
}

function childEnvironment() {
  const allowlist = ['HOME', 'USER', 'LOGNAME', 'SHELL', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM', 'CODEX_HOME', 'XDG_CONFIG_HOME'];
  return Object.fromEntries(allowlist.flatMap((key) => typeof process.env[key] === 'string' ? [[key, process.env[key]]] : []));
}

function validDispatchState(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.phase === 'QUARANTINED') return { phase: 'QUARANTINED', quarantinePath: typeof value.quarantinePath === 'string' ? value.quarantinePath : null };
  if (!/^[A-Za-z0-9_-]{24,128}$/.test(value.token || '')) return null;
  if (!['CLAIMING', 'RUNNING', 'RECOVERY_BLOCKED', 'EXECUTED'].includes(value.phase)) return null;
  if (value.phase === 'CLAIMING') return { token: value.token, phase: value.phase, updatedAt: value.updatedAt || null };
  const dispatch = value.dispatch;
  if (!dispatch || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(dispatch.threadId || '') || !/^[0-9a-f]{64}$/i.test(dispatch.fingerprint || '')) return null;
  const outcome = value.phase === 'EXECUTED' && ['SUCCEEDED', 'FAILED', 'TIMED_OUT'].includes(value.outcome) ? value.outcome : null;
  if (value.phase === 'EXECUTED' && !outcome) return null;
  const state = {
    token: value.token,
    phase: value.phase,
    dispatch: {
      threadId: dispatch.threadId,
      fingerprint: dispatch.fingerprint,
      lastCompletedAt: typeof dispatch.lastCompletedAt === 'string' ? dispatch.lastCompletedAt : null,
    },
    pid: Number.isInteger(value.pid) && value.pid > 1 ? value.pid : null,
    executionMarker: typeof value.executionMarker === 'string' && /^run-[A-Za-z0-9_-]{16,64}$/.test(value.executionMarker) ? value.executionMarker : null,
    spawnedAt: typeof value.spawnedAt === 'string' && !Number.isNaN(Date.parse(value.spawnedAt)) ? value.spawnedAt : null,
    outcome,
    exitCode: Number.isInteger(value.exitCode) ? value.exitCode : null,
    signal: typeof value.signal === 'string' ? value.signal : null,
    treeStopped: value.treeStopped === true,
    updatedAt: value.updatedAt || null,
  };
  if (['RUNNING', 'RECOVERY_BLOCKED'].includes(value.phase) && !state.executionMarker) return null;
  if (value.phase === 'RECOVERY_BLOCKED' && !state.pid) return null;
  return state;
}

function readDispatchState() {
  if (existsSync(QUARANTINE_MARKER_PATH)) return { phase: 'QUARANTINED', quarantinePath: basename(QUARANTINE_MARKER_PATH) };
  try {
    const state = validDispatchState(JSON.parse(readFileSync(CLAIM_STATE_PATH, 'utf8')));
    if (!state) throw new Error('COMPANY_OS_CODEX_DISPATCH_STATE_INVALID');
    return state;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
    const quarantinePath = join(STATE_DIR, `dispatch-state.invalid.${Date.now()}.${process.pid}.json`);
    writeDurableJson(QUARANTINE_MARKER_PATH, { phase: 'QUARANTINED', quarantinePath: basename(quarantinePath) });
    try { renameSync(CLAIM_STATE_PATH, quarantinePath); } catch { /* preserve fail-closed behavior below */ }
    process.stdout.write(JSON.stringify({ event: 'DISPATCH_STATE_QUARANTINED', path: basename(quarantinePath) }) + '\n');
    return { phase: 'QUARANTINED', quarantinePath: basename(quarantinePath) };
  }
}

function writeDurableJson(path, state) {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  const descriptor = openSync(temporaryPath, 'w', 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify({ ...state, updatedAt: new Date().toISOString() })}\n`);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporaryPath, path);
  try {
    const directoryDescriptor = openSync(STATE_DIR, 'r');
    try { fsyncSync(directoryDescriptor); } finally { closeSync(directoryDescriptor); }
  } catch { /* file fsync and atomic rename already provide the primary durability guarantee */ }
}

function writeDispatchState(state) {
  writeDurableJson(CLAIM_STATE_PATH, state);
}

function newDispatchState() {
  const state = { token: randomBytes(24).toString('base64url'), phase: 'CLAIMING' };
  writeDispatchState(state);
  return state;
}

function clearDispatchState() {
  try { unlinkSync(CLAIM_STATE_PATH); } catch { /* absent or already cleared */ }
}

function processGroupAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try { process.kill(-pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; }
}

function processMatchesDispatch(state) {
  if (!state.pid || !state.executionMarker) return false;
  try {
    const command = execFileSync('/bin/ps', ['-ww', '-p', String(state.pid), '-o', 'command='], {
      encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return command.includes(state.dispatch.threadId)
      && command.includes(state.executionMarker)
      && /codex/i.test(command);
  } catch {
    return false;
  }
}

async function waitForProcessGroup(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (processGroupAlive(pid) && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  return !processGroupAlive(pid);
}

async function stopProcessGroup(pid) {
  if (!processGroupAlive(pid)) return true;
  try { process.kill(-pid, 'SIGTERM'); } catch { /* already stopped */ }
  if (await waitForProcessGroup(pid, 10_000)) return true;
  try { process.kill(-pid, 'SIGKILL'); } catch { /* already stopped */ }
  return waitForProcessGroup(pid, 5_000);
}

function validateClaimDispatch(dispatch, projectedTasks) {
  if (!dispatch || typeof dispatch.threadId !== 'string' || typeof dispatch.fingerprint !== 'string') {
    throw new Error('COMPANY_OS_CODEX_CLAIM_INVALID');
  }
  const local = projectedTasks.find((task) => task.threadId === dispatch.threadId);
  if (!local
    || local.fingerprint !== dispatch.fingerprint
    || local.archived
    || local.attentionReason
    || !['IDLE', 'NOT_LOADED'].includes(local.sourceStatus)
    || (local.lastCompletedAt || null) !== (dispatch.lastCompletedAt || null)
    || dispatch.sourceProjectName !== local.projectName
    || !sessionCwd(dispatch.threadId)) {
    throw new Error('COMPANY_OS_CODEX_CLAIM_NOT_IN_LOCAL_PROJECTION');
  }
  return local;
}

function validateClaimResponse(value) {
  if (!value || typeof value !== 'object' || typeof value.claimed !== 'boolean') {
    throw new Error('COMPANY_OS_CODEX_DISPATCH_RESPONSE_INVALID');
  }
  if (value.claimed === false) {
    if (typeof value.reason !== 'string' || !UNCLAIMED_REASONS.has(value.reason)) {
      throw new Error('COMPANY_OS_CODEX_DISPATCH_RESPONSE_INVALID');
    }
    return value;
  }
  const dispatch = value.dispatch;
  if (!CLAIMED_REASONS.has(value.reason)
    || !dispatch || typeof dispatch !== 'object'
    || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(dispatch.threadId || '')
    || !/^[0-9a-f]{64}$/i.test(dispatch.fingerprint || '')
    || typeof dispatch.sourceProjectName !== 'string' || !dispatch.sourceProjectName.trim() || dispatch.sourceProjectName.length > 160
    || !Number.isInteger(dispatch.boardVersion) || dispatch.boardVersion < 1
    || !Object.prototype.hasOwnProperty.call(dispatch, 'lastCompletedAt')
    || (dispatch.lastCompletedAt !== null && (typeof dispatch.lastCompletedAt !== 'string' || Number.isNaN(Date.parse(dispatch.lastCompletedAt))))) {
    throw new Error('COMPANY_OS_CODEX_DISPATCH_RESPONSE_INVALID');
  }
  return value;
}

function runCodexResume(threadId, executionMarker, onSpawn) {
  return new Promise((resolveRun) => {
    const cwd = sessionCwd(threadId);
    if (!existsSync(CODEX_BIN) || !cwd) return resolveRun({ outcome: 'FAILED', exitCode: null, signal: null, treeStopped: true });
    mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
    const gatePath = join(STATE_DIR, `${executionMarker}.gate`);
    try { unlinkSync(gatePath); } catch { /* unique marker, normally absent */ }
    const runner = [
      'gate_path="$1"; shift',
      'attempt=0',
      'while [[ ! -f "$gate_path" && "$attempt" -lt 100 ]]; do /bin/sleep 0.1; attempt=$((attempt + 1)); done',
      '[[ -f "$gate_path" ]] || exit 125',
      '/bin/rm -f "$gate_path"',
      'exec "$@"',
    ].join('\n');
    const child = spawn('/bin/zsh', ['-c', runner, executionMarker, gatePath, CODEX_BIN,
      'exec', '--ignore-user-config', '--approve-for-me', '--sandbox', 'workspace-write', '--color', 'never', '--cd', cwd, '--skip-git-repo-check',
      'resume', '--all', threadId, `${AUTO_RESUME_PROMPT} Marcador local de ejecución: ${executionMarker}.`,
    ], { cwd, detached: true, env: childEnvironment(), stdio: ['ignore', 'ignore', 'pipe'] });
    let timedOut = false;
    let terminated = false;
    let forceKillTimer = null;
    let finished = false;
    let stderrBytes = 0;
    const stderrHash = createHash('sha256');
    const handleStderr = (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      stderrBytes += bytes.length;
      stderrHash.update(bytes);
    };
    child.stderr?.on('data', handleStderr);
    const stopTree = (signal) => {
      if (!child.pid) return;
      try { process.kill(-child.pid, signal); } catch { /* process group already exited */ }
    };
    const requestStop = () => {
      stopTree('SIGTERM');
      if (!forceKillTimer) forceKillTimer = setTimeout(() => stopTree('SIGKILL'), 10_000);
    };
    const handleTermination = () => {
      terminated = true;
      requestStop();
    };
    process.once('SIGTERM', handleTermination);
    process.once('SIGINT', handleTermination);
    const timeout = setTimeout(() => {
      timedOut = true;
      requestStop();
    }, AUTO_RESUME_TIMEOUT_MS);
    const finish = async (code, signal, forcedOutcome = null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      process.off('SIGTERM', handleTermination);
      process.off('SIGINT', handleTermination);
      try { unlinkSync(gatePath); } catch { /* wrapper already consumed it */ }
      const treeStopped = await stopProcessGroup(child.pid);
      child.stderr?.off('data', handleStderr);
      const outcome = forcedOutcome || (timedOut || terminated ? 'TIMED_OUT' : code === 0 && treeStopped ? 'SUCCEEDED' : 'FAILED');
      if (outcome !== 'SUCCEEDED') {
        try {
          const diagnosticPath = join(STATE_DIR, 'logs', 'last-codex-error.log');
          mkdirSync(join(STATE_DIR, 'logs'), { recursive: true, mode: 0o700 });
          writeFileSync(diagnosticPath, `${JSON.stringify({ observedAt: new Date().toISOString(), threadId, executionMarker, outcome, exitCode: Number.isInteger(code) ? code : null, signal: signal || null, stderrBytes, stderrSha256: stderrHash.digest('hex') })}\n`, { mode: 0o600 });
        } catch { /* diagnostics never supersede process cleanup and durable reporting */ }
      }
      resolveRun({ outcome, exitCode: Number.isInteger(code) ? code : null, signal: signal || null, treeStopped });
    };
    child.once('error', () => void finish(null, null, 'FAILED'));
    child.once('close', (code, signal) => void finish(code, signal));
    try {
      if (!child.pid) throw new Error('COMPANY_OS_CODEX_RUNNER_PID_MISSING');
      const spawnedAt = new Date().toISOString();
      onSpawn(child.pid, spawnedAt);
      writeFileSync(gatePath, 'go\n', { mode: 0o600, flag: 'wx' });
    } catch {
      terminated = true;
      requestStop();
      void finish(null, 'SPAWN_HANDSHAKE_FAILED', 'FAILED');
    }
  });
}

async function reportExecutedState(state) {
  await projectInventory();
  const report = await signedPost(DISPATCH_ENDPOINT, {
    action: 'REPORT', sourceHost: SOURCE_HOST, threadId: state.dispatch.threadId,
    fingerprint: state.dispatch.fingerprint, claimedLastCompletedAt: state.dispatch.lastCompletedAt,
    claimToken: state.token, outcome: state.outcome,
  }, 3);
  clearDispatchState();
  process.stdout.write(JSON.stringify({
    event: 'AUTO_RESUME_FINISHED', threadId: state.dispatch.threadId, outcome: state.outcome,
    exitCode: state.exitCode, treeStopped: state.treeStopped, refreshOk: true,
    verifiedCompletion: report.verifiedCompletion === true, status: report.humanStatus || null,
  }) + '\n');
  return report;
}

if (DRY_RUN) {
  const dryRunProjects = nativeCodexProjects();
  const initialTasks = await collect(dryRunProjects);
  const statuses = Object.fromEntries([...new Set(initialTasks.map((task) => task.humanStatus))].sort().map((status) => [status, initialTasks.filter((task) => task.humanStatus === status).length]));
  const projectNames = [...new Set(initialTasks.map((task) => task.projectName))].sort();
  const nativeProjectCount = new Set(dryRunProjects.map((project) => project.projectId)).size;
  process.stdout.write(JSON.stringify({ ok: true, dryRun: true, sourceHost: SOURCE_HOST, installId: INSTALL_ID, observedCount: initialTasks.length, nativeProjectCount, projectNames, statuses, autoResume: AUTO_RESUME }) + '\n');
  process.exit(0);
}

let state = AUTO_RESUME ? readDispatchState() : null;
if (state?.phase === 'QUARANTINED') {
  process.stderr.write('COMPANY_OS_CODEX_DISPATCH_STATE_QUARANTINED\n');
  process.exit(0);
}
if (state?.phase === 'RUNNING' || state?.phase === 'RECOVERY_BLOCKED') {
    const ownedProcess = processMatchesDispatch(state);
    const treeStopped = ownedProcess ? await stopProcessGroup(state.pid) : !state.pid || !processGroupAlive(state.pid);
    const recoverySignal = ownedProcess ? 'COLLECTOR_RESTART' : state.pid ? 'RECOVERY_IDENTITY_UNVERIFIED' : 'RESTART_BEFORE_SPAWN';
    state = { ...state, phase: treeStopped ? 'EXECUTED' : 'RECOVERY_BLOCKED', outcome: 'TIMED_OUT', exitCode: null, signal: recoverySignal, treeStopped };
    writeDispatchState(state);
    if (!treeStopped && !ownedProcess) {
      process.stderr.write('COMPANY_OS_CODEX_RECOVERY_IDENTITY_UNVERIFIED\n');
      process.exit(0);
    }
    if (!treeStopped) throw new Error('COMPANY_OS_CODEX_PROCESS_TREE_STILL_RUNNING');
  }

const projected = await projectInventory();
process.stdout.write(JSON.stringify({ event: 'COLLECTOR_SCAN_OK', ok: true, sourceHost: SOURCE_HOST, installId: INSTALL_ID, observedCount: projected.tasks.length, changedCount: projected.changedCount, scanId: projected.scanId }) + '\n');
let dispatchResult = { claimed: false, reason: AUTO_RESUME ? 'NO_APPROVED_TASK' : 'AUTO_RESUME_DISABLED' };
if (AUTO_RESUME) {
  if (state?.phase === 'EXECUTED') {
    const report = await reportExecutedState(state);
    dispatchResult = { claimed: true, reason: 'RECOVERED_REPORT', threadId: state.dispatch.threadId, verifiedCompletion: report.verifiedCompletion === true };
  } else {
    state = state || newDispatchState();
    const claim = validateClaimResponse(await signedPost(DISPATCH_ENDPOINT, { action: 'CLAIM', sourceHost: SOURCE_HOST, claimToken: state.token }, 3));
    dispatchResult = { claimed: claim.claimed === true, reason: claim.reason || null, threadId: claim.dispatch?.threadId || null };
    if (claim.claimed === true) {
      const dispatch = {
        threadId: claim.dispatch.threadId,
        fingerprint: claim.dispatch.fingerprint,
        lastCompletedAt: claim.dispatch.lastCompletedAt || null,
      };
      try {
        validateClaimDispatch(claim.dispatch, projected.tasks);
      } catch (error) {
        const rejected = { token: state.token, phase: 'EXECUTED', dispatch, pid: null, outcome: 'FAILED', exitCode: null, signal: 'LOCAL_PROJECTION_REJECTED', treeStopped: true };
        writeDispatchState(rejected);
        await reportExecutedState(rejected);
        throw error;
      }
      process.stdout.write(JSON.stringify({ event: 'DISPATCH_POLL_OK', ok: true, sourceHost: SOURCE_HOST, installId: INSTALL_ID, claimed: true, reason: claim.reason || null, threadId: dispatch.threadId }) + '\n');
      const executionMarker = `run-${randomBytes(18).toString('base64url')}`;
      state = { token: state.token, phase: 'RUNNING', dispatch, pid: null, executionMarker, spawnedAt: null };
      writeDispatchState(state);
      process.stdout.write(JSON.stringify({ event: 'AUTO_RESUME_STARTED', threadId: dispatch.threadId, fingerprint: dispatch.fingerprint }) + '\n');
      const execution = await runCodexResume(dispatch.threadId, executionMarker, (pid, spawnedAt) => {
        state = { ...state, pid, spawnedAt };
        writeDispatchState(state);
      });
      state = { ...state, phase: execution.treeStopped ? 'EXECUTED' : 'RECOVERY_BLOCKED', ...execution };
      writeDispatchState(state);
      if (!execution.treeStopped) throw new Error('COMPANY_OS_CODEX_PROCESS_TREE_STILL_RUNNING');
      const report = await reportExecutedState(state);
      dispatchResult = { ...dispatchResult, verifiedCompletion: report.verifiedCompletion === true };
    } else {
      process.stdout.write(JSON.stringify({ event: 'DISPATCH_POLL_OK', ok: true, sourceHost: SOURCE_HOST, installId: INSTALL_ID, claimed: false, reason: claim.reason }) + '\n');
      if (claim.reason !== 'DISPATCH_ALREADY_ACTIVE') clearDispatchState();
    }
  }
}
process.stdout.write(JSON.stringify({ ok: true, sourceHost: SOURCE_HOST, installId: INSTALL_ID, observedCount: projected.tasks.length, changedCount: projected.changedCount, scanId: projected.scanId, dispatch: dispatchResult }) + '\n');
