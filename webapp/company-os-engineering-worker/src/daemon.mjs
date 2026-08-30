import { randomUUID } from 'node:crypto';
import { EngineeringApiClient } from './api-client.mjs';
import { createHealthServer } from './health.mjs';
import { InstanceLock } from './lock.mjs';
import { EngineeringRunner } from './runner.mjs';
import { EngineeringReconciler } from './github-effect.mjs';
import { EngineeringGoalReconciler } from './goal-reconciler.mjs';

export class EngineeringDaemon {
  constructor({ config, api = null, runner = null, reconciler = null, goalReconciler = null, logger = console, now = () => new Date() }) {
    this.config = config;
    this.instanceId = randomUUID();
    this.api = api || new EngineeringApiClient({ baseUrl: config.apiBaseUrl, secret: config.secret, workerId: config.workerId, instanceId: this.instanceId, timeoutMs: config.apiTimeoutMs });
    this.runner = runner || new EngineeringRunner({ config, api: this.api, logger });
    this.reconciler = reconciler || new EngineeringReconciler({ config, api: this.api });
    this.goalReconciler = goalReconciler || new EngineeringGoalReconciler({ config, api: this.api, logger });
    this.logger = logger;
    this.now = now;
    this.state = 'STARTING';
    this.startedAt = now().toISOString();
    this.lastClaimAt = null;
    this.controlPlaneObservedAt = null;
    this.currentMissionId = null;
    this.lastErrorCode = null;
    this.running = false;
    this.tickInFlight = false;
    this.timer = null;
    this.lock = new InstanceLock(config.lockPath, this.instanceId);
    this.health = createHealthServer({ port: config.healthPort, snapshot: () => this.snapshot() });
  }
  snapshot() {
    return { workerId: this.config.workerId, instanceId: this.instanceId, binaryVersion: this.config.binaryVersion, contractVersion: this.config.contractVersion, state: this.state, startedAt: this.startedAt, lastClaimAt: this.lastClaimAt, controlPlaneObservedAt: this.controlPlaneObservedAt, currentMissionId: this.currentMissionId, lastErrorCode: this.lastErrorCode, maxAutonomy: this.config.maxAutonomy, ...(this.goalReconciler?.snapshot?.() || {}) };
  }
  goalPlaneHealthy() {
    const health = this.goalReconciler?.snapshot?.().goalReconcilerHealthy;
    return health === undefined ? true : health === true;
  }
  async tick() {
    if (!this.running || this.currentMissionId || this.tickInFlight) return;
    this.tickInFlight = true;
    try {
      if (this.goalReconciler) {
        try {
          await this.goalReconciler.reconcileIfDue();
        } catch (error) {
          this.goalReconciler.recordFailure?.(error);
          this.lastErrorCode = error?.code || 'ENGINEERING_GOAL_RECONCILE_FAILED';
        }
      }
      const claim = await this.api.claim();
      this.lastClaimAt = this.now().toISOString();
      this.controlPlaneObservedAt = this.lastClaimAt;
      if (this.goalPlaneHealthy()) this.lastErrorCode = null;
      if (!claim) {
        this.state = this.goalPlaneHealthy() ? 'IDLE' : 'DEGRADED';
        if (this.state === 'DEGRADED') {
          this.lastErrorCode = this.goalReconciler?.snapshot?.().goalReconcilerErrorCodes?.[0]
            || 'ENGINEERING_GOAL_RECONCILER_DEGRADED';
        }
        return;
      }
      this.currentMissionId = claim?.mission?.missionId || 'INVALID';
      this.state = 'BUSY';
      if (claim.mode === 'EXECUTE') await this.runner.execute(claim);
      else if (claim.mode === 'RECONCILE') await this.reconciler.reconcile(claim);
      else throw Object.assign(new Error('CLAIM_MODE_INVALID'), { code: 'CLAIM_MODE_INVALID' });
      this.goalReconciler?.wake?.();
      this.state = this.goalPlaneHealthy() ? 'IDLE' : 'DEGRADED';
    } catch (error) {
      this.lastErrorCode = error?.code || 'ENGINEERING_TICK_FAILED';
      this.state = 'DEGRADED';
      this.logger.error?.('ENGINEERING_TICK_FAILED', { code: this.lastErrorCode });
    } finally {
      this.currentMissionId = null;
      this.tickInFlight = false;
    }
  }
  async start() {
    this.lock.acquire();
    await this.health.listen();
    this.running = true;
    this.state = 'IDLE';
    this.timer = setInterval(() => void this.tick(), this.config.pollIntervalMs);
    this.timer.unref?.();
    await this.tick();
  }
  async stop() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.state = 'STOPPED';
    await this.health.close();
    this.lock.release();
  }
}
