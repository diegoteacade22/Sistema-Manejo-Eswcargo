import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { InstanceLock } from './instance-lock.mjs';
import { runtimeOutputSchemaForClaim } from './openai-client.mjs';
import { createRuntimeHealthServer } from './runtime-health.mjs';
import { assertClaim, safeFailure } from './worker.mjs';

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function workKey(claim) {
  return claim.workItemId || claim.requestId;
}

export function assertRuntimeClaim(claim) {
  assertClaim(claim);
  for (const key of ['workItemId', 'attemptId', 'leaseExpiresAt', 'handlerKey', 'contractVersion']) {
    if (typeof claim[key] !== 'string' || !claim[key]) {
      throw Object.assign(new Error(`Runtime claim is missing ${key}`), { code: 'INVALID_RUNTIME_CLAIM', retryable: false });
    }
  }
  if (!Number.isSafeInteger(claim.attempt) || claim.attempt < 1
    || !Number.isSafeInteger(claim.slotNo) || claim.slotNo < 1
    || !Number.isSafeInteger(claim.timeoutMs) || claim.timeoutMs < 1
    || !Array.isArray(claim.contextMessages)
    || !claim.budgets || typeof claim.budgets !== 'object' || Array.isArray(claim.budgets)
    || Number.isNaN(new Date(claim.leaseExpiresAt).getTime())) {
    throw Object.assign(new Error('Runtime claim metadata is invalid'), { code: 'INVALID_RUNTIME_CLAIM', retryable: false });
  }
  if ((claim.contract?.agentId !== undefined && claim.contract.agentId !== claim.agentId)
    || (claim.contract?.handlerKey !== undefined && claim.contract.handlerKey !== claim.handlerKey)
    || (claim.contract?.version !== undefined && claim.contract.version !== claim.contractVersion)) {
    throw Object.assign(new Error('Runtime claim contract identity does not match'), { code: 'INVALID_RUNTIME_CONTRACT', retryable: false });
  }
  runtimeOutputSchemaForClaim(claim);
  return claim;
}

export class CompanyOsRuntimeDaemon {
  constructor({
    config,
    api,
    processor,
    logger,
    instanceId = randomUUID(),
    lock,
    healthServerFactory = createRuntimeHealthServer,
    now = () => new Date(),
    sleep = delay,
    externalSourceProbe = async () => [],
  }) {
    this.config = config;
    this.api = api;
    this.processor = processor;
    this.logger = logger;
    this.instanceId = instanceId;
    this.now = now;
    this.sleep = sleep;
    this.externalSourceProbe = externalSourceProbe;
    this.startedAt = now().toISOString();
    this.lock = lock || new InstanceLock({
      lockPath: join(config.stateDir, 'runtime.lock'),
      workerId: config.workerId,
      instanceId,
      now,
    });
    this.healthServerFactory = healthServerFactory;
    this.healthServer = null;
    this.activeWork = new Map();
    this.failures = new Map();
    this.timers = new Set();
    this.running = false;
    this.draining = false;
    this.stopped = false;
    this.starting = true;
    this.polling = false;
    this.workerHeartbeating = false;
    this.reconciling = false;
    this.scheduling = false;
    this.scheduleScanCount = 0;
    this.lastWorkerHeartbeatAt = null;
    this.lastState = 'STARTING';
    this.apiDependency = { status: 'UNOBSERVED', observedAt: null, detail: null };
    this.modelRouterDependency = { status: 'UNOBSERVED', observedAt: null, detail: null };
    this.openAiDependency = { status: 'UNOBSERVED', observedAt: null, detail: null };
    this.ollamaDependency = { status: 'UNOBSERVED', observedAt: null, detail: null };
    this.externalDependencies = [];
    this.externalProbing = false;
  }

  effectiveState() {
    if (this.stopped) return 'STOPPED';
    if (this.draining) return 'DRAINING';
    if (this.starting) return 'STARTING';
    if (this.failures.size > 0 || this.processor.persistenceBlocked) return 'DEGRADED';
    if (this.activeWork.size > 0) return 'BUSY';
    return 'IDLE';
  }

  transitionIfNeeded(reason) {
    const state = this.effectiveState();
    if (state !== this.lastState) {
      this.logger.info('RUNTIME_STATE_CHANGED', { from: this.lastState, to: state, reason });
      this.lastState = state;
    }
    return state;
  }

  markFailure(operation, error) {
    const failure = safeFailure(error);
    this.failures.set(operation, failure.code);
    this.apiDependency = { status: 'DEGRADED', observedAt: this.now().toISOString(), detail: failure.code };
    this.logger.error('RUNTIME_OPERATION_FAILED', { operation, code: failure.code, message: failure.message, retryable: failure.retryable });
    this.transitionIfNeeded(`${operation}:failed`);
  }

  markSuccess(operation) {
    this.apiDependency = { status: 'HEALTHY', observedAt: this.now().toISOString(), detail: null };
    if (this.failures.delete(operation)) this.logger.info('RUNTIME_OPERATION_RECOVERED', { operation });
    this.transitionIfNeeded(`${operation}:ok`);
  }

  observeModelResult(result) {
    if (result?.status === 'COMPLETED') {
      this.failures.delete('openai');
      this.failures.delete('model');
      const observedAt = this.now().toISOString();
      const provider = result.modelProvider === 'ollama' ? 'ollama' : 'openai';
      this.modelRouterDependency = { status: 'HEALTHY', observedAt, detail: `${provider}:${result.model || 'unknown'}` };
      if (provider === 'ollama') {
        this.ollamaDependency = { status: 'HEALTHY', observedAt, detail: result.model || 'qwen-local' };
        if (typeof result.fallbackReason === 'string' && result.fallbackReason.trim()) {
          this.openAiDependency = { status: 'DEGRADED', observedAt, detail: result.fallbackReason };
        }
      } else {
        this.openAiDependency = { status: 'HEALTHY', observedAt, detail: result.model || null };
      }
      this.transitionIfNeeded('model:ok');
      return;
    }
    const code = result?.error?.code;
    if (typeof code === 'string' && (code.startsWith('OPENAI_') || code.startsWith('OLLAMA_') || code.startsWith('MODEL_ROUTER_'))) {
      const observedAt = this.now().toISOString();
      this.failures.set('model', code);
      this.modelRouterDependency = { status: 'DEGRADED', observedAt, detail: code };
      if (code === 'MODEL_ROUTER_FALLBACK_FAILED') {
        this.openAiDependency = { status: 'DEGRADED', observedAt, detail: result.error.primaryCode || 'OPENAI_UNKNOWN_ERROR' };
        this.ollamaDependency = { status: 'DEGRADED', observedAt, detail: result.error.fallbackCode || 'OLLAMA_UNKNOWN_ERROR' };
      } else if (code.startsWith('OPENAI_')) this.openAiDependency = { status: 'DEGRADED', observedAt, detail: code };
      else if (code.startsWith('OLLAMA_')) this.ollamaDependency = { status: 'DEGRADED', observedAt, detail: code };
      this.transitionIfNeeded('model:failed');
    }
  }

  currentWork() {
    return [...this.activeWork.values()].map(({ claim, startedAt }) => ({
      workItemId: claim.workItemId || null,
      requestId: claim.requestId,
      caseId: claim.caseId,
      agentId: claim.agentId,
      startedAt,
    }));
  }

  snapshot() {
    return {
      workerId: this.config.workerId,
      instanceId: this.instanceId,
      version: this.config.version,
      binaryVersion: this.config.binaryVersion || this.config.version,
      contractVersion: this.config.contractVersion || 'runtime-v1',
      sourceRevision: this.config.sourceRevision || null,
      state: this.effectiveState(),
      startedAt: this.startedAt,
      lastWorkerHeartbeatAt: this.lastWorkerHeartbeatAt,
      activeCount: this.activeWork.size,
      capacity: this.config.globalConcurrency,
      acceptingWork: this.running && !this.draining && !this.processor.persistenceBlocked,
      pendingCompletionCount: this.processor.pendingCompletionCount || 0,
      currentWork: this.currentWork(),
      lastErrorCode: this.failures.values().next().value || null,
    };
  }

  heartbeatPayload(state = this.effectiveState()) {
    const observedAt = this.now().toISOString();
    return {
      state,
      host: this.config.hostName,
      version: this.config.version,
      binaryVersion: this.config.binaryVersion || this.config.version,
      contractVersion: this.config.contractVersion || 'runtime-v1',
      startedAt: this.startedAt,
      observedAt,
      capacity: this.config.globalConcurrency,
      allowedAgentIds: this.config.allowedAgentIds,
      currentWork: this.currentWork(),
      lastErrorCode: this.failures.values().next().value || null,
      dependencies: [
        { key: 'network', ...this.apiDependency },
        { key: 'vercel-api', ...this.apiDependency },
        { key: 'supabase-postgres', status: 'UNOBSERVED', observedAt: null, detail: 'Observed only through the signed Vercel API' },
        { key: 'inference-router', ...this.modelRouterDependency },
        { key: 'openai-api', ...this.openAiDependency },
        { key: 'ollama-local', ...this.ollamaDependency },
        { key: 'openclaw-optional', status: 'UNOBSERVED', observedAt: null, detail: 'Optional dependency not configured' },
        ...this.externalDependencies,
      ],
      externalSources: this.externalDependencies.map(({ key, sourceId, status, observedAt, detail, latencyMs, itemBatch }) => ({
        key, sourceId, status, observedAt, detail, latencyMs, ...(itemBatch ? { itemBatch } : {}),
      })),
    };
  }

  installTimer(callback, intervalMs) {
    const timer = setInterval(() => void callback(), intervalMs);
    timer.unref?.();
    this.timers.add(timer);
  }

  installTimeout(callback, delayMs) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      void callback();
    }, delayMs);
    timer.unref?.();
    this.timers.add(timer);
  }

  clearTimers() {
    for (const timer of this.timers) clearInterval(timer);
    this.timers.clear();
  }

  async start({ runImmediately = true } = {}) {
    if (this.running) return this.snapshot();
    this.lock.acquire();
    try {
      this.healthServer = this.healthServerFactory({
        host: this.config.healthHost,
        port: this.config.healthPort,
        snapshot: () => this.snapshot(),
      });
      const address = await this.healthServer.listen();
      this.running = true;
      this.logger.info('RUNTIME_STARTED', {
        workerId: this.config.workerId,
        instanceId: this.instanceId,
        version: this.config.version,
        binaryVersion: this.config.binaryVersion || this.config.version,
        contractVersion: this.config.contractVersion || 'runtime-v1',
        healthHost: this.config.healthHost,
        healthPort: address?.port || this.config.healthPort,
        globalConcurrency: this.config.globalConcurrency,
        externalNotificationsEnabled: this.config.externalNotificationsEnabled,
      });
      await this.tickExternalSources();
      await this.recoverCompletions();
      await this.tickWorkerHeartbeat(this.processor.persistenceBlocked ? 'DEGRADED' : 'STARTING');
      this.starting = false;
      this.transitionIfNeeded('startup-complete');
      if (this.failures.has('worker-heartbeat')) this.installTimeout(() => this.tickWorkerHeartbeat(), 5_000);
      this.installTimer(() => this.tickPoll(), this.config.pollIntervalMs);
      this.installTimer(() => this.tickWorkerHeartbeat(), this.config.workerHeartbeatIntervalMs);
      this.installTimer(() => this.tickReconcile(), this.config.reconcileIntervalMs);
      this.installTimer(() => this.tickSchedule({ trigger: 'INTERVAL' }), this.config.scheduleIntervalMs);
      this.installTimer(() => this.tickExternalSources(), this.config.scheduleIntervalMs);
      if (runImmediately) {
        void this.tickReconcile();
        void this.tickSchedule({ trigger: 'STARTUP' });
        void this.tickPoll();
      }
      return this.snapshot();
    } catch (error) {
      this.running = false;
      try { await this.healthServer?.close(); } catch {}
      this.lock.release();
      throw error;
    }
  }

  async tickExternalSources() {
    if (!this.running || this.draining || this.externalProbing) return null;
    this.externalProbing = true;
    try {
      const result = await this.externalSourceProbe();
      this.externalDependencies = Array.isArray(result) ? result.filter((item) => item && typeof item.key === 'string') : [];
      this.logger.info('RUNTIME_EXTERNAL_SOURCES_OBSERVED', {
        sources: this.externalDependencies.map(({ sourceId, status, latencyMs }) => ({ sourceId: sourceId || null, status, latencyMs: latencyMs ?? null })),
      });
      return this.externalDependencies;
    } catch (error) {
      this.logger.error('RUNTIME_EXTERNAL_SOURCES_FAILED', { code: safeFailure(error).code });
      return null;
    } finally {
      this.externalProbing = false;
    }
  }

  async tickWorkerHeartbeat(forcedState) {
    if (!this.running || this.workerHeartbeating) return null;
    this.workerHeartbeating = true;
    try {
      const result = await this.api.workerHeartbeat(this.heartbeatPayload(forcedState));
      this.lastWorkerHeartbeatAt = this.now().toISOString();
      this.markSuccess('worker-heartbeat');
      return result;
    } catch (error) {
      this.markFailure('worker-heartbeat', error);
      return null;
    } finally {
      this.workerHeartbeating = false;
    }
  }

  async tickReconcile() {
    if (!this.running || this.draining || this.reconciling) return null;
    this.reconciling = true;
    try {
      const result = await this.api.reconcile();
      this.markSuccess('reconcile');
      return result;
    } catch (error) {
      this.markFailure('reconcile', error);
      return null;
    } finally {
      this.reconciling = false;
    }
  }

  async tickSchedule({ trigger = 'MANUAL' } = {}) {
    if (!this.running || this.draining || this.scheduling) return null;
    this.scheduling = true;
    const startedAt = this.now();
    const scan = {
      scanId: randomUUID(),
      scanNumber: ++this.scheduleScanCount,
      workerId: this.config.workerId,
      instanceId: this.instanceId,
      trigger: ['INTERVAL', 'STARTUP'].includes(trigger) ? trigger : 'MANUAL',
      startedAt: startedAt.toISOString(),
    };
    this.logger.info('RUNTIME_SCHEDULE_SCAN_STARTED', scan);
    try {
      const result = await this.api.schedule();
      this.markSuccess('schedule');
      const rows = Array.isArray(result?.results) ? result.results : null;
      const countsObserved = rows !== null
        && Number.isSafeInteger(result.scheduled) && result.scheduled === rows.length
        && rows.every((row) => typeof row?.reused === 'boolean');
      const continuous = result?.continuous;
      const continuousCountsObserved = continuous !== null && typeof continuous === 'object' && !Array.isArray(continuous)
        && ['generatedCount', 'observed', 'excluded', 'scannedObjectives']
          .every((key) => Number.isSafeInteger(continuous[key]) && continuous[key] >= 0);
      const continuousReasonObserved = continuousCountsObserved
        && typeof continuous.noWorkReason === 'string'
        && /^[A-Z0-9_]{3,80}$/.test(continuous.noWorkReason);
      const finishedAt = this.now();
      this.logger.info('RUNTIME_SCHEDULE_SCAN_FINISHED', {
        ...scan,
        finishedAt: finishedAt.toISOString(),
        durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
        success: true,
        exitCode: 0,
        countsObserved,
        scheduledCount: countsObserved ? rows.length : null,
        generatedCount: countsObserved ? rows.filter((row) => !row.reused).length : null,
        reusedCount: countsObserved ? rows.filter((row) => row.reused).length : null,
        continuousCountsObserved,
        continuousGeneratedCount: continuousCountsObserved ? continuous.generatedCount : null,
        continuousSourcesObserved: continuousCountsObserved ? continuous.observed : null,
        continuousExcludedCount: continuousCountsObserved ? continuous.excluded : null,
        continuousObjectivesScanned: continuousCountsObserved ? continuous.scannedObjectives : null,
        continuousEligibleSourceCount: continuousCountsObserved && Number.isSafeInteger(continuous.eligibleSources) && continuous.eligibleSources >= 0
          ? continuous.eligibleSources : null,
        continuousBlockedExternalCount: continuousCountsObserved && Number.isSafeInteger(continuous.blockedExternal) && continuous.blockedExternal >= 0
          ? continuous.blockedExternal : null,
        continuousNoWorkReason: continuousReasonObserved ? continuous.noWorkReason : null,
        errorCode: null,
      });
      return result;
    } catch (error) {
      this.markFailure('schedule', error);
      const finishedAt = this.now();
      this.logger.error('RUNTIME_SCHEDULE_SCAN_FINISHED', {
        ...scan,
        finishedAt: finishedAt.toISOString(),
        durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
        success: false,
        exitCode: 1,
        countsObserved: false,
        scheduledCount: null,
        generatedCount: null,
        reusedCount: null,
        continuousCountsObserved: false,
        continuousGeneratedCount: null,
        continuousSourcesObserved: null,
        continuousExcludedCount: null,
        continuousObjectivesScanned: null,
        continuousEligibleSourceCount: null,
        continuousBlockedExternalCount: null,
        continuousNoWorkReason: null,
        errorCode: safeFailure(error).code,
      });
      return null;
    } finally {
      this.scheduling = false;
    }
  }

  agentAlreadyActive(agentId) {
    return [...this.activeWork.values()].some((entry) => entry.claim.agentId === agentId);
  }

  async rejectUnsafeClaim(claim, code, message, retryable = true) {
    this.logger.error('RUNTIME_CLAIM_REJECTED', { code, requestId: claim?.requestId || null, agentId: claim?.agentId || null });
    if (!claim?.leaseToken || !claim?.requestId || !claim?.caseId || !claim?.workItemId) return;
    try {
      await this.api.fail(claim, { code, message, retryable });
      this.markSuccess('claim-rejection');
    } catch (error) {
      this.markFailure('claim-rejection', error);
    }
  }

  startClaim(claim) {
    const key = workKey(claim);
    const startedAt = this.now().toISOString();
    const controller = new AbortController();
    const execution = Promise.resolve()
      .then(() => this.processor.runClaim(claim, { signal: controller.signal }))
      .then((result) => {
        this.observeModelResult(result);
        this.logger.info('RUNTIME_CLAIM_FINISHED', {
          requestId: claim.requestId,
          workItemId: claim.workItemId || null,
          agentId: claim.agentId,
          status: result?.status || 'UNKNOWN',
        });
        return result;
      })
      .catch((error) => {
        const failure = safeFailure(error);
        this.observeModelResult({ status: 'FAILED', error: failure });
        this.logger.error('RUNTIME_CLAIM_CRASHED', {
          requestId: claim.requestId || null,
          workItemId: claim.workItemId || null,
          agentId: claim.agentId || null,
          code: failure.code,
          message: failure.message,
        });
        return { status: 'FAILED', error: failure };
      })
      .finally(() => {
        this.activeWork.delete(key);
        this.transitionIfNeeded('claim-finished');
        if (this.running && !this.draining) queueMicrotask(() => void this.tickPoll());
      });
    this.activeWork.set(key, { claim, startedAt, execution, controller });
    this.logger.info('RUNTIME_CLAIM_STARTED', {
      requestId: claim.requestId,
      workItemId: claim.workItemId || null,
      agentId: claim.agentId,
      activeCount: this.activeWork.size,
    });
    this.transitionIfNeeded('claim-started');
    return execution;
  }

  async recoverCompletions() {
    if (typeof this.processor.drainCompletions !== 'function') return true;
    try {
      const result = await this.processor.drainCompletions();
      if (result.blocked) {
        this.failures.set('completion-persistence', 'COMPLETION_PENDING');
        this.transitionIfNeeded('completion:pending');
        return false;
      }
      this.failures.delete('completion-persistence');
      this.transitionIfNeeded('completion:confirmed');
      return true;
    } catch {
      this.failures.set('completion-persistence', 'COMPLETION_OUTBOX_UNAVAILABLE');
      this.transitionIfNeeded('completion:unavailable');
      return false;
    }
  }

  async tickPoll() {
    if (!this.running || this.draining || this.polling) return null;
    this.polling = true;
    let claimed = 0;
    let attempts = 0;
    const maxAttempts = this.config.globalConcurrency * 4;
    try {
      if (!await this.recoverCompletions()) return { claimed: 0, attempts: 0, pendingCompletions: this.processor.pendingCompletionCount || 0 };
      while (!this.draining && !this.processor.persistenceBlocked && this.activeWork.size < this.config.globalConcurrency && attempts < maxAttempts) {
        attempts += 1;
        const claim = await this.api.claim();
        this.markSuccess('claim');
        if (claim === null) break;
        try {
          assertRuntimeClaim(claim);
        } catch (error) {
          const failure = safeFailure(error);
          await this.rejectUnsafeClaim(claim, failure.code, failure.message, false);
          continue;
        }
        if (!this.config.allowedAgentIds.includes(claim.agentId)) {
          await this.rejectUnsafeClaim(claim, 'AGENT_NOT_ALLOWED', 'Claimed agent is not installed on this worker');
          continue;
        }
        const key = workKey(claim);
        if (this.activeWork.has(key)) {
          await this.rejectUnsafeClaim(claim, 'DUPLICATE_LOCAL_CLAIM', 'Work item is already active on this runtime');
          continue;
        }
        if (this.agentAlreadyActive(claim.agentId)) {
          await this.rejectUnsafeClaim(claim, 'AGENT_CONCURRENCY_EXCEEDED', 'Agent concurrency is limited to one');
          continue;
        }
        this.startClaim(claim);
        claimed += 1;
      }
      if (attempts === maxAttempts && this.activeWork.size < this.config.globalConcurrency) {
        this.logger.warn('RUNTIME_POLL_ATTEMPT_LIMIT', { attempts, claimed });
      }
      return { claimed, attempts };
    } catch (error) {
      this.markFailure('claim', error);
      return null;
    } finally {
      this.polling = false;
      this.transitionIfNeeded('poll-complete');
    }
  }

  async sendTerminalHeartbeat(state) {
    try {
      await this.api.workerHeartbeat(this.heartbeatPayload(state));
      this.lastWorkerHeartbeatAt = this.now().toISOString();
    } catch (error) {
      this.markFailure('worker-heartbeat', error);
    }
  }

  async stop(reason = 'SIGTERM') {
    if (this.stopped) return { drained: true, activeRemaining: 0 };
    if (this.draining) return { drained: false, activeRemaining: this.activeWork.size };
    this.draining = true;
    this.clearTimers();
    this.transitionIfNeeded(reason);
    this.logger.info('RUNTIME_DRAINING', { reason, activeCount: this.activeWork.size, timeoutMs: this.config.shutdownGraceMs });
    await this.sendTerminalHeartbeat('DRAINING');

    const executions = [...this.activeWork.values()].map((entry) => entry.execution);
    let drained = executions.length === 0;
    if (!drained) {
      drained = await Promise.race([
        Promise.allSettled(executions).then(() => true),
        this.sleep(this.config.shutdownGraceMs).then(() => false),
      ]);
    }
    if (!drained) this.logger.warn('RUNTIME_DRAIN_TIMEOUT', { activeRemaining: this.activeWork.size });
    if (!drained) {
      for (const entry of this.activeWork.values()) entry.controller.abort();
      const cleanupWaitMs = Math.min(10_000, Math.max(2_000, Math.trunc(this.config.shutdownGraceMs / 3)));
      await Promise.race([
        Promise.allSettled([...this.activeWork.values()].map((entry) => entry.execution)),
        this.sleep(cleanupWaitMs),
      ]);
      drained = this.activeWork.size === 0;
      if (!drained) this.logger.error('RUNTIME_ABORT_CLEANUP_TIMEOUT', { activeRemaining: this.activeWork.size, cleanupWaitMs });
    }
    await this.sendTerminalHeartbeat('STOPPED');
    this.running = false;
    this.stopped = true;
    this.draining = false;
    this.transitionIfNeeded('shutdown-complete');
    try { await this.healthServer?.close(); } finally { this.lock.release(); }
    this.logger.info('RUNTIME_STOPPED', { drained, activeRemaining: this.activeWork.size });
    return { drained, activeRemaining: this.activeWork.size };
  }
}
