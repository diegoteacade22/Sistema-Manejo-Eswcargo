import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { ENGINEERING_BINARY_VERSION, ENGINEERING_CONTRACT_VERSION } from './version.mjs';

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function integer(value, fallback, min, max, name) {
  const parsed = value ? Number(value) : fallback;
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error(`${name}_INVALID`);
  return parsed;
}

function executable(env, name, fallback) {
  const value = env[name]?.trim() || fallback;
  if (!isAbsolute(value)) throw new Error(`${name}_MUST_BE_ABSOLUTE`);
  return value;
}

function workerIdentity(value) {
  const workerId = value?.trim() || 'diegoserver-engineering-v2';
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(workerId)) {
    throw new Error('ENGINEERING_WORKER_ID_INVALID');
  }
  return workerId;
}

export function validateApiOrigin(value, allowedHosts) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || (url.pathname && url.pathname !== '/') || url.search || url.hash) {
    throw new Error('ENGINEERING_API_ORIGIN_INVALID');
  }
  if (!allowedHosts.includes(url.hostname)) throw new Error('ENGINEERING_API_HOST_NOT_ALLOWLISTED');
  return url.origin;
}

export function loadConfig(env = process.env) {
  const stateDir = resolve(env.COMPANY_OS_ENGINEERING_STATE_DIR?.trim() || join(homedir(), '.company-os-engineering-v2'));
  const home = resolve(homedir());
  if (stateDir === home || !stateDir.startsWith(`${home}/`)) throw new Error('ENGINEERING_STATE_DIR_INVALID');
  const repositoryPath = resolve(required(env, 'COMPANY_OS_ENGINEERING_REPOSITORY_PATH'));
  const codexAuthDir = resolve(required(env, 'COMPANY_OS_ENGINEERING_CODEX_AUTH_DIR'));
  const repositorySlug = required(env, 'COMPANY_OS_ENGINEERING_REPOSITORY_SLUG');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repositorySlug)) throw new Error('ENGINEERING_REPOSITORY_SLUG_INVALID');
  const baseBranch = env.COMPANY_OS_ENGINEERING_BASE_BRANCH?.trim() || 'main';
  if (baseBranch !== 'main') throw new Error('ENGINEERING_BASE_BRANCH_NOT_ALLOWED');
  const allowedHosts = (env.COMPANY_OS_ENGINEERING_ALLOWED_HOSTS || 'webapp-weld-psi.vercel.app,app.eswcargo.com')
    .split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
  const maxAutonomy = env.COMPANY_OS_ENGINEERING_MAX_AUTONOMY?.trim() || 'A1';
  if (!['A1', 'A2'].includes(maxAutonomy)) throw new Error('ENGINEERING_MAX_AUTONOMY_INVALID');
  const githubToken = env.COMPANY_OS_ENGINEERING_GITHUB_TOKEN?.trim() || null;
  if (maxAutonomy === 'A2' && !githubToken) throw new Error('COMPANY_OS_ENGINEERING_GITHUB_TOKEN_REQUIRED');
  return Object.freeze({
    apiBaseUrl: validateApiOrigin(env.COMPANY_OS_ENGINEERING_API_BASE_URL?.trim() || 'https://webapp-weld-psi.vercel.app', allowedHosts),
    allowedHosts,
    secret: required(env, 'COMPANY_OS_ENGINEERING_HMAC_SECRET'),
    workerId: workerIdentity(env.COMPANY_OS_ENGINEERING_WORKER_ID),
    binaryVersion: ENGINEERING_BINARY_VERSION,
    contractVersion: ENGINEERING_CONTRACT_VERSION,
    repositoryPath,
    codexAuthDir,
    repositorySlug,
    baseBranch,
    maxAutonomy,
    githubToken,
    stateDir,
    jobsDir: join(stateDir, 'jobs'),
    lockPath: join(stateDir, 'engineering.lock'),
    logDir: join(stateDir, 'logs'),
    healthPort: integer(env.COMPANY_OS_ENGINEERING_HEALTH_PORT, 8795, 1024, 65535, 'ENGINEERING_HEALTH_PORT'),
    pollIntervalMs: integer(env.COMPANY_OS_ENGINEERING_POLL_INTERVAL_MS, 15_000, 5_000, 300_000, 'ENGINEERING_POLL_INTERVAL_MS'),
    goalReconcileMinMs: integer(env.COMPANY_OS_ENGINEERING_GOAL_RECONCILE_MIN_MS, 30_000, 5_000, 300_000, 'ENGINEERING_GOAL_RECONCILE_MIN_MS'),
    goalReconcileMaxMs: integer(env.COMPANY_OS_ENGINEERING_GOAL_RECONCILE_MAX_MS, 900_000, 60_000, 3_600_000, 'ENGINEERING_GOAL_RECONCILE_MAX_MS'),
    heartbeatIntervalMs: integer(env.COMPANY_OS_ENGINEERING_HEARTBEAT_INTERVAL_MS, 30_000, 10_000, 120_000, 'ENGINEERING_HEARTBEAT_INTERVAL_MS'),
    commandTimeoutMs: integer(env.COMPANY_OS_ENGINEERING_COMMAND_TIMEOUT_MS, 600_000, 30_000, 900_000, 'ENGINEERING_COMMAND_TIMEOUT_MS'),
    apiTimeoutMs: integer(env.COMPANY_OS_ENGINEERING_API_TIMEOUT_MS, 15_000, 1_000, 60_000, 'ENGINEERING_API_TIMEOUT_MS'),
    gitBin: executable(env, 'COMPANY_OS_ENGINEERING_GIT_BIN', '/usr/bin/git'),
    ghBin: executable(env, 'COMPANY_OS_ENGINEERING_GH_BIN', '/opt/homebrew/bin/gh'),
    dockerBin: executable(env, 'COMPANY_OS_ENGINEERING_DOCKER_BIN', '/usr/local/bin/docker'),
    codexImage: env.COMPANY_OS_ENGINEERING_CODEX_IMAGE?.trim() || 'company-os-codex:0.150.1',
  });
}
