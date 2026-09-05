import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { validateOllamaBaseUrl } from './ollama-client.mjs';

export const COMPANY_OS_RUNTIME_BINARY_VERSION = '1.1.0';
export const COMPANY_OS_RUNTIME_CONTRACT_VERSION = 'runtime-v1';
export const COMPANY_OS_RUNTIME_VERSION = COMPANY_OS_RUNTIME_BINARY_VERSION;
export const DEFAULT_RUNTIME_API_BASE_URL = 'https://webapp-weld-psi.vercel.app';
export const DEFAULT_RUNTIME_ALLOWED_HOSTS = ['webapp-weld-psi.vercel.app', 'app.eswcargo.com'];
export const DEFAULT_LOCAL_LINEAGE_MODEL = 'qwen3:4b-q4_K_M';

export function validateLocalLineageModel(value) {
  if (value !== DEFAULT_LOCAL_LINEAGE_MODEL) {
    throw new Error('COMPANY_OS_RUNTIME_LOCAL_LINEAGE_MODEL must be the allowlisted local model qwen3:4b-q4_K_M');
  }
  return value;
}

function required(name, env) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function integerInRange(value, fallback, name, min, max) {
  const candidate = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(candidate) || candidate < min || candidate > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return candidate;
}

function booleanValue(value, fallback, name) {
  if (value === undefined || value === '') return fallback;
  if (/^(1|true|yes)$/i.test(value)) return true;
  if (/^(0|false|no)$/i.test(value)) return false;
  throw new Error(`${name} must be true or false`);
}

function identifier(value, name) {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(value)) throw new Error(`${name} is invalid`);
  return value;
}

function modelIdentifier(value, name) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value)) throw new Error(`${name} is invalid`);
  return value;
}

export function validateRuntimeApiBaseUrl(rawValue, allowedHosts = DEFAULT_RUNTIME_ALLOWED_HOSTS) {
  const url = new URL(rawValue);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')
    || (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
    throw new Error('COMPANY_OS_RUNTIME_API_BASE_URL must be a pure HTTPS origin');
  }
  if (!allowedHosts.includes(url.hostname)) throw new Error(`COMPANY_OS_RUNTIME_API_BASE_URL host is not allowlisted: ${url.hostname}`);
  return url.origin;
}

export function loadRuntimeConfig(env = process.env) {
  const allowedHosts = (env.COMPANY_OS_RUNTIME_ALLOWED_HOSTS || DEFAULT_RUNTIME_ALLOWED_HOSTS.join(','))
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (allowedHosts.length === 0 || allowedHosts.some((value) => !/^[a-z0-9.-]+$/.test(value))) {
    throw new Error('COMPANY_OS_RUNTIME_ALLOWED_HOSTS is invalid');
  }

  const stateDir = env.COMPANY_OS_RUNTIME_STATE_DIR?.trim() || join(homedir(), '.company-os-runtime');
  const chatgptWorkProjectIds = (env.COMPANY_OS_RUNTIME_CHATGPT_WORK_PROJECT_IDS || '')
    .split(',').map((value) => value.trim()).filter(Boolean)
    .map((value) => identifier(value, 'COMPANY_OS_RUNTIME_CHATGPT_WORK_PROJECT_IDS'));
  const externalNotificationsEnabled = booleanValue(
    env.COMPANY_OS_RUNTIME_EXTERNAL_NOTIFICATIONS_ENABLED,
    false,
    'COMPANY_OS_RUNTIME_EXTERNAL_NOTIFICATIONS_ENABLED',
  );
  if (externalNotificationsEnabled) {
    throw new Error('COMPANY_OS_RUNTIME_EXTERNAL_NOTIFICATIONS_ENABLED must remain false for runtime v1');
  }
  const sourceRevision = env.COMPANY_OS_RUNTIME_SOURCE_REVISION?.trim() || null;
  if (sourceRevision !== null && !/^[a-f0-9]{40}$/.test(sourceRevision)) {
    throw new Error('COMPANY_OS_RUNTIME_SOURCE_REVISION must be a full Git commit');
  }

  return Object.freeze({
    apiBaseUrl: validateRuntimeApiBaseUrl(env.COMPANY_OS_RUNTIME_API_BASE_URL?.trim() || DEFAULT_RUNTIME_API_BASE_URL, allowedHosts),
    allowedHosts,
    hmacSecret: required('COMPANY_OS_RUNTIME_HMAC_SECRET', env),
    openAiApiKey: required('OPENAI_API_KEY', env),
    openAiBaseUrl: (env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/$/, ''),
    model: env.COMPANY_OS_RUNTIME_MODEL?.trim() || env.COMPANY_OS_V3_MODEL?.trim() || 'gpt-5.6-sol',
    workerId: identifier(env.COMPANY_OS_RUNTIME_WORKER_ID?.trim() || 'diegoserver-company-os', 'COMPANY_OS_RUNTIME_WORKER_ID'),
    hostName: env.COMPANY_OS_RUNTIME_HOSTNAME?.trim() || hostname(),
    version: COMPANY_OS_RUNTIME_VERSION,
    binaryVersion: COMPANY_OS_RUNTIME_BINARY_VERSION,
    contractVersion: COMPANY_OS_RUNTIME_CONTRACT_VERSION,
    sourceRevision,
    healthHost: '127.0.0.1',
    healthPort: integerInRange(env.COMPANY_OS_RUNTIME_HEALTH_PORT, 8794, 'COMPANY_OS_RUNTIME_HEALTH_PORT', 1024, 65535),
    pollIntervalMs: integerInRange(env.COMPANY_OS_RUNTIME_POLL_INTERVAL_MS, 15_000, 'COMPANY_OS_RUNTIME_POLL_INTERVAL_MS', 5_000, 300_000),
    workerHeartbeatIntervalMs: integerInRange(env.COMPANY_OS_RUNTIME_WORKER_HEARTBEAT_INTERVAL_MS, 60_000, 'COMPANY_OS_RUNTIME_WORKER_HEARTBEAT_INTERVAL_MS', 10_000, 300_000),
    reconcileIntervalMs: integerInRange(env.COMPANY_OS_RUNTIME_RECONCILE_INTERVAL_MS, 60_000, 'COMPANY_OS_RUNTIME_RECONCILE_INTERVAL_MS', 10_000, 300_000),
    scheduleIntervalMs: integerInRange(env.COMPANY_OS_RUNTIME_SCHEDULE_INTERVAL_MS, 60_000, 'COMPANY_OS_RUNTIME_SCHEDULE_INTERVAL_MS', 10_000, 300_000),
    leaseHeartbeatIntervalMs: integerInRange(env.COMPANY_OS_RUNTIME_LEASE_HEARTBEAT_INTERVAL_MS, 30_000, 'COMPANY_OS_RUNTIME_LEASE_HEARTBEAT_INTERVAL_MS', 10_000, 120_000),
    globalConcurrency: integerInRange(env.COMPANY_OS_RUNTIME_GLOBAL_CONCURRENCY, 2, 'COMPANY_OS_RUNTIME_GLOBAL_CONCURRENCY', 1, 2),
    shutdownGraceMs: integerInRange(env.COMPANY_OS_RUNTIME_SHUTDOWN_GRACE_MS, 30_000, 'COMPANY_OS_RUNTIME_SHUTDOWN_GRACE_MS', 1_000, 30_000),
    apiTimeoutMs: integerInRange(env.COMPANY_OS_RUNTIME_API_TIMEOUT_MS, 15_000, 'COMPANY_OS_RUNTIME_API_TIMEOUT_MS', 1_000, 60_000),
    openAiTimeoutMs: integerInRange(env.COMPANY_OS_RUNTIME_OPENAI_TIMEOUT_MS, 120_000, 'COMPANY_OS_RUNTIME_OPENAI_TIMEOUT_MS', 5_000, 600_000),
    ollamaFallbackEnabled: booleanValue(env.COMPANY_OS_RUNTIME_OLLAMA_FALLBACK_ENABLED, true, 'COMPANY_OS_RUNTIME_OLLAMA_FALLBACK_ENABLED'),
    ollamaBaseUrl: validateOllamaBaseUrl(env.COMPANY_OS_RUNTIME_OLLAMA_BASE_URL?.trim() || 'http://127.0.0.1:11434'),
    ollamaModel: modelIdentifier(env.COMPANY_OS_RUNTIME_OLLAMA_MODEL?.trim() || 'qwen3:14b-q4_K_M', 'COMPANY_OS_RUNTIME_OLLAMA_MODEL'),
    localLineageModel: validateLocalLineageModel(env.COMPANY_OS_RUNTIME_LOCAL_LINEAGE_MODEL?.trim() || DEFAULT_LOCAL_LINEAGE_MODEL),
    ollamaTimeoutMs: integerInRange(env.COMPANY_OS_RUNTIME_OLLAMA_TIMEOUT_MS, 120_000, 'COMPANY_OS_RUNTIME_OLLAMA_TIMEOUT_MS', 5_000, 600_000),
    googleServiceAccountJson: env.COMPANY_OS_RUNTIME_GOOGLE_SERVICE_ACCOUNT_JSON?.trim() || null,
    externalIdentitySecret: required('COMPANY_OS_EXTERNAL_IDENTITY_HMAC_SECRET', env),
    chatgptWorkExportPath: join(stateDir, 'bridges', 'chatgpt-work.json'),
    chatgptWorkProjectIds,
    stateDir,
    logDir: env.COMPANY_OS_RUNTIME_LOG_DIR?.trim() || join(stateDir, 'logs'),
    logMaxBytes: integerInRange(env.COMPANY_OS_RUNTIME_LOG_MAX_BYTES, 5_242_880, 'COMPANY_OS_RUNTIME_LOG_MAX_BYTES', 1_024, 104_857_600),
    logMaxFiles: integerInRange(env.COMPANY_OS_RUNTIME_LOG_MAX_FILES, 5, 'COMPANY_OS_RUNTIME_LOG_MAX_FILES', 1, 20),
    consoleLogEnabled: booleanValue(env.COMPANY_OS_RUNTIME_CONSOLE_LOG_ENABLED, true, 'COMPANY_OS_RUNTIME_CONSOLE_LOG_ENABLED'),
    allowedAgentIds: (env.COMPANY_OS_RUNTIME_ALLOWED_AGENT_IDS || 'general-manager-ai-v3,systems-manager-ai-v1,data-manager-ai-v1')
      .split(',').map((value) => identifier(value.trim(), 'COMPANY_OS_RUNTIME_ALLOWED_AGENT_IDS')).filter(Boolean),
    externalNotificationsEnabled,
    telegramTarget: null,
    telegramBotToken: null,
  });
}
