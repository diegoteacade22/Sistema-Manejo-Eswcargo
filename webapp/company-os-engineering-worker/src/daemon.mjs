import { randomUUID } from 'node:crypto';
import { EngineeringApiClient } from './api-client.mjs';
import { createHealthServer } from './health.mjs';
import { InstanceLock } from './lock.mjs';
import { EngineeringRunner } from './runner.mjs';
import { EngineeringReconciler } from './github-effect.mjs';

export class EngineeringDaemon {
  constructor({ config, api = null, runner = null, reconciler = null, logger = console, now = () => new Date() }) {
    this.config = config;
    this.instanceId = randomUUID();
    this.api = api || new EngineeringApiClient({ baseUrl: config.apiBaseUrl, secret: config.secret, workerId: config.workerId, instanceId: this.instanceId, timeoutMs: config.apiTimeoutMs });
    this.runner = runner || new EngineeringRunner({ config, api: this.api, logger });
    this.reconciler = reconciler || new EngineeringReconciler({ config, api: this.api });
    this.logger = logger;
    this.now = now;
    this.state = 'STARTING';
    this.startedAt = now().toISOString();
    this.lastClaimAt = null;
    this.controlPlaneObservedAt = null;
    this.currentMissionId = null;
    this.lastErrorCode = null;
    this.running = false;
    this.timer = null;
    this.lock = new InstanceLock(config.lockPath, this.instanceId);
    this.health = createHealthServer({ port: config.healthPort, snapshot: () => this.snapshot() });
  }
  snapshot() {
    return { workerId: this.config.workerId, instanceId: this.instanceId, state: this.state, startedAt: this.startedAt, lastClaimAt: this.lastClaimAt, controlPlaneObservedAt: this.controlPlaneObservedAt, currentMissionId: this.currentMissionId, lastErrorCode: this.lastErrorCode, maxAutonomy: this.config.maxAutonomy };
  }
  async tick() {
    if (!this.running || this.currentMissionId) return;
    try {
      const claim = await this.api.claim();
      this.lastClaimAt = this.now().toISOString();
      this.controlPlaneObservedAt = this.lastClaimAt;
      this.lastErrorCode = null;
      if (!claim) { this.state = 'IDLE'; return; }
      this.currentMissionId = claim?.mission?.missionId || 'INVALID';
      this.state = 'BUSY';
      if (claim.mode === 'EXECUTE') await this.runner.execute(claim);
      else if (claim.mode === 'RECONCILE') await this.reconciler.reconcile(claim);
      else throw Object.assign(new Error('CLAIM_MODE_INVALID'), { code: 'CLAIM_MODE_INVALID' });
      this.state = 'IDLE';
    } catch (error) {
      this.lastErrorCode = error?.code || 'ENGINEERING_TICK_FAILED';
      this.state = 'DEGRADED';
      this.logger.error?.('ENGINEERING_TICK_FAILED', { code: this.lastErrorCode });
    } finally {
      this.currentMissionId = null;
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
