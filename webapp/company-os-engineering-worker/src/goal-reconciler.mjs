import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isProhibitedPath, normalizeRelativePath, pathWithin } from './policy.mjs';
import { githubGitEnvironment, nonSecretEnvironment, runProcess } from './process.mjs';

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function evidenceHash(value) {
  return hash(canonicalJson(value));
}

function error(code) {
  return Object.assign(new Error(code), { code, retryable: false });
}

function secureGitHubEnvironment(config) {
  const base = config.githubToken
    ? githubGitEnvironment(config.githubToken)
    : nonSecretEnvironment();
  return {
    ...base,
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '/usr/bin/false',
    GIT_SSH_COMMAND: '/usr/bin/false',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
  };
}

export function validateGoalSpec(goal, config) {
  if (!goal || typeof goal !== 'object' || Array.isArray(goal)) throw error('ENGINEERING_GOAL_INVALID');
  for (const key of ['goalId', 'goalKey', 'sourceRef', 'sourceHash', 'objective', 'repository', 'baseBranch', 'policyHash']) {
    if (typeof goal[key] !== 'string' || !goal[key]) throw error('ENGINEERING_GOAL_INVALID');
  }
  if (goal.sourceKind !== 'REPOSITORY_DOCUMENT') throw error('ENGINEERING_GOAL_SOURCE_DENIED');
  if (goal.repository !== config.repositorySlug || goal.baseBranch !== config.baseBranch) throw error('ENGINEERING_GOAL_AUTHORITY_DENIED');
  if (!Number.isSafeInteger(goal.version) || goal.version < 1 || !Number.isSafeInteger(goal.priority)
    || !Number.isSafeInteger(goal.missionTtlMinutes) || goal.missionTtlMinutes < 5 || goal.missionTtlMinutes > 1440
    || !Number.isFinite(goal.budgetUsd) || goal.budgetUsd <= 0 || goal.budgetUsd > 10
    || !['A1', 'A2'].includes(goal.autonomyLevel)
    || (goal.autonomyLevel === 'A2' && config.maxAutonomy !== 'A2')
    || !/^[a-f0-9]{64}$/.test(goal.sourceHash) || !/^[a-f0-9]{64}$/.test(goal.policyHash)) {
    throw error('ENGINEERING_GOAL_AUTHORITY_DENIED');
  }
  if (goal.observationCursor !== null
    && (typeof goal.observationCursor !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/.test(goal.observationCursor))) {
    throw error('ENGINEERING_GOAL_CURSOR_INVALID');
  }
  if (!Array.isArray(goal.allowedPaths) || goal.allowedPaths.length === 0
    || !Array.isArray(goal.acceptanceCriteria) || goal.acceptanceCriteria.length === 0) {
    throw error('ENGINEERING_GOAL_INVALID');
  }
  const allowedPaths = goal.allowedPaths.map(normalizeRelativePath);
  if (allowedPaths.some(isProhibitedPath)) throw error('ENGINEERING_GOAL_AUTHORITY_DENIED');
  const sourceRef = normalizeRelativePath(goal.sourceRef);
  if (isProhibitedPath(sourceRef)) throw error('ENGINEERING_GOAL_SOURCE_DENIED');
  const desired = goal.desiredState;
  if (!desired || typeof desired !== 'object' || Array.isArray(desired)
    || Object.keys(desired).length !== 3
    || Object.keys(desired).some((key) => !['type', 'path', 'needles'].includes(key))
    || desired.type !== 'FILE_CONTAINS_ALL' || typeof desired.path !== 'string'
    || !Array.isArray(desired.needles) || desired.needles.length < 2 || desired.needles.length > 20
    || desired.needles.some((needle) => typeof needle !== 'string' || !needle || needle.length > 500)
    || new Set(desired.needles).size !== desired.needles.length) {
    throw error('ENGINEERING_GOAL_DESIRED_STATE_INVALID');
  }
  const desiredPath = normalizeRelativePath(desired.path);
  if (isProhibitedPath(desiredPath) || !pathWithin(desiredPath, allowedPaths)) throw error('ENGINEERING_GOAL_AUTHORITY_DENIED');
  return {
    ...goal,
    sourceRef,
    allowedPaths,
    desiredState: { type: 'FILE_CONTAINS_ALL', path: desiredPath, needles: [...desired.needles] },
  };
}

export class EngineeringGoalReconciler {
  constructor({ config, api, logger = console, now = Date.now, processRunner = runProcess }) {
    this.config = config;
    this.api = api;
    this.logger = logger;
    this.now = now;
    this.processRunner = processRunner;
    this.nextAt = 0;
    this.backoffMs = config.goalReconcileMinMs;
    this.lastReconciledAt = null;
    this.lastDecision = null;
    this.activeGoals = 0;
    this.healthy = false;
    this.lastSummary = null;
    this.lastErrorCodes = ['ENGINEERING_GOALS_UNOBSERVED'];
  }

  snapshot() {
    return {
      lastGoalReconcileAt: this.lastReconciledAt,
      lastGoalDecision: this.lastDecision,
      activeGoals: this.activeGoals,
      nextGoalReconcileAt: this.nextAt ? new Date(this.nextAt).toISOString() : null,
      goalReconcilerHealthy: this.healthy,
      goalReconcilerSummary: this.lastSummary,
      goalReconcilerErrorCodes: this.lastErrorCodes,
    };
  }

  wake() {
    this.nextAt = 0;
    this.backoffMs = this.config.goalReconcileMinMs;
  }

  recordFailure(failure) {
    const code = failure?.code || 'ENGINEERING_GOAL_RECONCILE_FAILED';
    this.lastReconciledAt = new Date(this.now()).toISOString();
    this.lastDecision = 'DEGRADED';
    this.healthy = false;
    this.lastErrorCodes = [code];
    this.backoffMs = Math.min(
      this.config.goalReconcileMaxMs,
      Math.max(this.config.goalReconcileMinMs, this.backoffMs * 2),
    );
    this.nextAt = this.now() + this.backoffMs;
    this.logger.error?.('ENGINEERING_GOAL_PLANE_FAILED', { code, retryInMs: this.backoffMs });
    return this.snapshot();
  }

  async git(args, options = {}) {
    if (!this.authorityGitDir) throw error('ENGINEERING_GOAL_AUTHORITY_CACHE_MISSING');
    const { env: requestedEnvironment = {}, ...rest } = options;
    const inheritedCount = Number(requestedEnvironment.GIT_CONFIG_COUNT || 0);
    return this.processRunner(this.config.gitBin, ['--git-dir', this.authorityGitDir, ...args], {
      cwd: this.config.stateDir || tmpdir(),
      timeoutMs: 120_000,
      env: {
        ...nonSecretEnvironment(),
        ...requestedEnvironment,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_SYSTEM: '/dev/null',
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS: '/usr/bin/false',
        GIT_SSH_COMMAND: '/usr/bin/false',
        GIT_NO_REPLACE_OBJECTS: '1',
        GIT_CONFIG_COUNT: String(inheritedCount + 1),
        [`GIT_CONFIG_KEY_${inheritedCount}`]: 'core.hooksPath',
        [`GIT_CONFIG_VALUE_${inheritedCount}`]: '/dev/null',
      },
      ...rest,
    });
  }

  async cleanupAuthorityCache() {
    const gitDir = this.authorityGitDir;
    this.authorityGitDir = null;
    if (gitDir) await rm(gitDir, { recursive: true, force: true });
  }

  async fileAt(baseCommit, path, required = false) {
    const listing = await this.git(['ls-tree', '-z', baseCommit, '--', path], {
      stdoutLimitBytes: 8 * 1024,
      failOnStdoutLimit: true,
    });
    if (!listing.stdout) {
      if (required) throw error('ENGINEERING_GOAL_SOURCE_MISSING');
      return null;
    }
    const expectedSuffix = `\t${path}\u0000`;
    if (!listing.stdout.endsWith(expectedSuffix) || !/^(100644|100755) blob [a-f0-9]{40}\t/.test(listing.stdout)) {
      throw error('ENGINEERING_GOAL_BLOB_INVALID');
    }
    const result = await this.git(['cat-file', 'blob', `${baseCommit}:${path}`], {
      stdoutLimitBytes: 1024 * 1024,
      failOnStdoutLimit: true,
    });
    return result.stdout;
  }

  async observe(goal, baseCommit) {
    const source = await this.fileAt(baseCommit, goal.sourceRef, true);
    const actualSourceHash = hash(source);
    if (actualSourceHash !== goal.sourceHash) {
      const observedState = {
        type: 'GOAL_ISSUE',
        code: 'SOURCE_HASH_MISMATCH',
        sourceRef: goal.sourceRef,
        actualHash: actualSourceHash,
      };
      return {
        goalId: goal.goalId,
        expectedObservationCursor: goal.observationCursor,
        baseCommit,
        observedSatisfied: false,
        observedState,
        evidenceHash: evidenceHash({ goalId: goal.goalId, baseCommit, observedSatisfied: false, observedState }),
      };
    }
    const content = await this.fileAt(baseCommit, goal.desiredState.path, false);
    const fileExists = content !== null;
    const matchedNeedleHashes = fileExists
      ? goal.desiredState.needles.filter((needle) => content.includes(needle)).map((needle) => evidenceHash({ needle })).sort()
      : [];
    const matched = fileExists && matchedNeedleHashes.length === goal.desiredState.needles.length;
    const observedState = {
      type: 'FILE_CONTAINS_ALL',
      path: goal.desiredState.path,
      fileExists,
      matched,
      contentHash: fileExists ? hash(content) : null,
      matchedNeedleHashes,
    };
    return {
      goalId: goal.goalId,
      expectedObservationCursor: goal.observationCursor,
      baseCommit,
      observedSatisfied: matched,
      observedState,
      evidenceHash: evidenceHash({ goalId: goal.goalId, baseCommit, observedSatisfied: matched, observedState }),
    };
  }

  async fetchAuthoritativeBase() {
    await this.cleanupAuthorityCache();
    const authorityRoot = this.config.stateDir || tmpdir();
    await mkdir(authorityRoot, { recursive: true, mode: 0o700 });
    this.authorityGitDir = await mkdtemp(join(authorityRoot, 'goal-authority-'));
    await this.processRunner(this.config.gitBin, ['init', '--bare', this.authorityGitDir], {
      cwd: authorityRoot,
      timeoutMs: 30_000,
      env: {
        ...nonSecretEnvironment(),
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_SYSTEM: '/dev/null',
        GIT_NO_REPLACE_OBJECTS: '1',
      },
    });
    const explicitRemote = `https://github.com/${this.config.repositorySlug}.git`;
    const targetRef = `refs/heads/company-os-goals-${this.config.baseBranch}`;
    await this.git([
      'fetch', '--no-tags', '--force', explicitRemote,
      `+refs/heads/${this.config.baseBranch}:${targetRef}`,
    ], { env: secureGitHubEnvironment(this.config) });
    const baseCommit = (await this.git(['rev-parse', targetRef], {
      env: nonSecretEnvironment(),
    })).stdout.trim().toLowerCase();
    if (!/^[a-f0-9]{40}$/.test(baseCommit)) throw error('ENGINEERING_GOAL_BASE_INVALID');
    return baseCommit;
  }

  async reconcileIfDue({ force = false } = {}) {
    if (!force && this.now() < this.nextAt) return null;
    const goals = [];
    const seenCursors = new Set();
    const errorCodes = [];
    let cursor = null;
    let invalid = 0;
    do {
      const response = await this.api.goals(cursor);
      const rawGoals = Array.isArray(response?.goals) ? response.goals : [];
      for (const rawGoal of rawGoals) {
        try {
          goals.push(validateGoalSpec(rawGoal, this.config));
        } catch (failure) {
          invalid += 1;
          errorCodes.push(failure?.code || 'ENGINEERING_GOAL_INVALID');
          this.logger.error?.('ENGINEERING_GOAL_REJECTED', {
            goalId: typeof rawGoal?.goalId === 'string' ? rawGoal.goalId : null,
            code: failure?.code || 'ENGINEERING_GOAL_INVALID',
          });
        }
      }
      const invalidGoals = Array.isArray(response?.invalidGoals) ? response.invalidGoals : [];
      invalid += invalidGoals.length;
      for (const invalidGoal of invalidGoals) {
        errorCodes.push(typeof invalidGoal?.code === 'string' ? invalidGoal.code : 'ENGINEERING_GOAL_INVALID');
        this.logger.error?.('ENGINEERING_GOAL_REJECTED', {
          goalId: typeof invalidGoal?.goalId === 'string' ? invalidGoal.goalId : null,
          code: typeof invalidGoal?.code === 'string' ? invalidGoal.code : 'ENGINEERING_GOAL_INVALID',
        });
      }
      const nextCursor = typeof response?.nextCursor === 'string' && response.nextCursor ? response.nextCursor : null;
      if (nextCursor && seenCursors.has(nextCursor)) throw error('ENGINEERING_GOAL_CURSOR_LOOP');
      if (nextCursor) seenCursors.add(nextCursor);
      cursor = nextCursor;
      if (seenCursors.size > 100) throw error('ENGINEERING_GOAL_PAGE_LIMIT');
    } while (cursor);
    this.activeGoals = goals.length + invalid;
    if (goals.length === 0 && invalid === 0) {
      this.lastReconciledAt = new Date(this.now()).toISOString();
      this.lastDecision = 'QUIESCENT';
      this.healthy = true;
      this.lastSummary = { observed: 0, materialized: 0, quiescent: 0, pending: 0, stale: 0, invalid: 0, awaitingHuman: 0, blockedFinal: 0, expired: 0 };
      this.lastErrorCodes = [];
      this.nextAt = this.now() + this.config.goalReconcileMaxMs;
      return this.lastSummary;
    }
    const baseCommit = await this.fetchAuthoritativeBase();
    let materialized = 0;
    let quiescent = 0;
    let pending = 0;
    let stale = 0;
    let awaitingHuman = 0;
    let blockedFinal = 0;
    let expired = 0;
    for (const goal of goals) {
      try {
        const observation = await this.observe(goal, baseCommit);
        const result = await this.api.observeGoal(observation);
        if (result?.decision === 'MATERIALIZED') materialized += 1;
        else if (result?.decision === 'QUIESCENT') quiescent += 1;
        else if (result?.decision === 'PENDING') pending += 1;
        else if (result?.decision === 'STALE') stale += 1;
        else if (result?.decision === 'AWAITING_HUMAN') awaitingHuman += 1;
        else if (result?.decision === 'BLOCKED_FINAL') blockedFinal += 1;
        else if (result?.decision === 'EXPIRED') expired += 1;
        else throw error('ENGINEERING_GOAL_DECISION_INVALID');
      } catch (failure) {
        invalid += 1;
        errorCodes.push(failure?.code || 'ENGINEERING_GOAL_RECONCILE_FAILED');
        this.logger.error?.('ENGINEERING_GOAL_RECONCILE_FAILED', {
          goalId: goal.goalId,
          code: failure?.code || 'ENGINEERING_GOAL_RECONCILE_FAILED',
        });
      }
    }
    this.lastReconciledAt = new Date(this.now()).toISOString();
    this.lastDecision = materialized > 0 ? 'MATERIALIZED'
      : invalid > 0 || stale > 0 || blockedFinal > 0 || expired > 0 ? 'DEGRADED'
        : awaitingHuman > 0 ? 'AWAITING_HUMAN'
        : pending > 0 ? 'PENDING' : 'QUIESCENT';
    this.healthy = invalid === 0 && stale === 0 && blockedFinal === 0 && expired === 0;
    this.lastSummary = { observed: goals.length, materialized, quiescent, pending, stale, invalid, awaitingHuman, blockedFinal, expired };
    this.lastErrorCodes = [...new Set([
      ...errorCodes,
      ...(stale > 0 ? ['ENGINEERING_GOAL_STALE'] : []),
      ...(blockedFinal > 0 ? ['ENGINEERING_GOAL_BLOCKED_FINAL'] : []),
      ...(expired > 0 ? ['ENGINEERING_GOAL_EXPIRED'] : []),
    ])].slice(0, 20);
    this.backoffMs = materialized > 0
      ? this.config.goalReconcileMinMs
      : Math.min(this.config.goalReconcileMaxMs, Math.max(this.config.goalReconcileMinMs, this.backoffMs * 2));
    this.nextAt = this.now() + this.backoffMs;
    this.logger.info?.('ENGINEERING_GOALS_RECONCILED', {
      ...this.lastSummary,
    });
    await this.cleanupAuthorityCache();
    return this.lastSummary;
  }
}
