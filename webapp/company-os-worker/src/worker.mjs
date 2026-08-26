import { redactExternalText, redactExternalValue } from './redaction.mjs';

export function assertClaim(claim) {
  const required = ['leaseToken', 'requestId', 'caseId', 'agentId', 'objective', 'evidencePayload'];
  if (!claim || typeof claim !== 'object' || required.some((key) => !(key in claim))) {
    throw Object.assign(new Error('Claim payload is invalid'), { code: 'INVALID_CLAIM', retryable: false });
  }
  for (const key of ['leaseToken', 'requestId', 'caseId', 'agentId', 'objective']) {
    if (typeof claim[key] !== 'string' || !claim[key]) throw Object.assign(new Error('Claim payload is invalid'), { code: 'INVALID_CLAIM', retryable: false });
  }
  return claim;
}

export function safeFailure(error) {
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : 'WORKER_FAILURE';
  const message = typeof error?.message === 'string'
    ? redactExternalText(error.message, 500)
    : 'Worker failed';
  return { code, message, retryable: error?.retryable === true };
}

export class CompanyOsWorker {
  constructor({ api, openai, notifier = null, heartbeatIntervalMs = 30_000, failClosedInitialHeartbeat = false, onError = () => {} }) {
    this.api = api;
    this.openai = openai;
    this.notifier = notifier;
    this.heartbeatIntervalMs = heartbeatIntervalMs;
    this.failClosedInitialHeartbeat = failClosedInitialHeartbeat;
    this.onError = onError;
  }

  async runOnce(requestId) {
    const claim = await this.api.claim(requestId);
    if (claim === null) return { status: 'NO_CONTENT' };
    return this.runClaim(claim);
  }

  async runClaim(claim, { signal: shutdownSignal } = {}) {
    assertClaim(claim);

    let heartbeatBusy = false;
    let leaseFailure = null;
    const executionController = new AbortController();
    const abortForShutdown = () => {
      leaseFailure = Object.assign(new Error('Runtime shutdown aborted the active claim'), {
        code: 'RUNTIME_SHUTDOWN_ABORTED',
        retryable: true,
      });
      executionController.abort();
    };
    if (shutdownSignal?.aborted) abortForShutdown();
    else shutdownSignal?.addEventListener('abort', abortForShutdown, { once: true });
    const heartbeat = async (required = false) => {
      if (heartbeatBusy) return;
      heartbeatBusy = true;
      try {
        await this.api.heartbeat(claim);
      } catch (error) {
        this.onError(error);
        leaseFailure = Object.assign(new Error('Runtime lease heartbeat failed; model execution aborted'), {
          code: 'LEASE_HEARTBEAT_FAILED',
          retryable: true,
          cause: error,
        });
        executionController.abort();
        if (required) throw leaseFailure;
      } finally {
        heartbeatBusy = false;
      }
    };
    const interval = setInterval(() => void heartbeat(), this.heartbeatIntervalMs);
    interval.unref?.();

    try {
      await heartbeat(this.failClosedInitialHeartbeat);
      if (executionController.signal.aborted) throw leaseFailure ?? Object.assign(new Error('Claim aborted before model execution'), { code: 'OPENAI_ABORTED', retryable: true });
      const { output, usage } = await this.openai.generate(claim, { signal: executionController.signal });
      if (executionController.signal.aborted) throw leaseFailure ?? Object.assign(new Error('Claim aborted after model execution'), { code: 'OPENAI_ABORTED', retryable: true });
      const safeOutput = redactExternalValue(output);
      const completion = await this.api.complete(claim, safeOutput, usage);
      if (this.notifier) {
        let reservation = null;
        try {
          reservation = await this.api.prepareNotification(claim);
          if (reservation?.send) {
            const delivery = await this.notifier.send(claim, safeOutput, completion?.status);
            await this.api.notification(claim, reservation.reservationId, delivery);
          }
        } catch (notificationError) {
          const delivery = { status: 'FAILED', responseCode: null, error: safeFailure(notificationError) };
          try { if (reservation?.reservationId) await this.api.notification(claim, reservation.reservationId, delivery); } catch (reportError) { this.onError(reportError); }
          this.onError(notificationError);
        }
      }
      return { status: 'COMPLETED', requestId: claim.requestId, caseId: claim.caseId };
    } catch (error) {
      const reportedError = leaseFailure ?? error;
      const failure = {
        ...safeFailure(reportedError),
        ...(error?.usage && typeof error.usage === 'object' ? { usage: error.usage } : {}),
      };
      try {
        await this.api.fail(claim, failure);
      } catch (failError) {
        this.onError(failError);
      }
      return { status: 'FAILED', requestId: claim.requestId, caseId: claim.caseId, error: failure };
    } finally {
      clearInterval(interval);
      shutdownSignal?.removeEventListener('abort', abortForShutdown);
    }
  }
}

export class SerialWebhookQueue {
  constructor({ worker, dedupeTtlMs = 3_600_000, now = Date.now }) {
    this.worker = worker;
    this.dedupeTtlMs = dedupeTtlMs;
    this.now = now;
    this.seen = new Map();
    this.tail = Promise.resolve();
  }

  prune() {
    const cutoff = this.now() - this.dedupeTtlMs;
    for (const [requestId, seenAt] of this.seen) {
      if (seenAt < cutoff) this.seen.delete(requestId);
    }
  }

  enqueue(requestId) {
    this.prune();
    if (this.seen.has(requestId)) return { accepted: true, deduped: true };
    this.seen.set(requestId, this.now());
    this.tail = this.tail.then(() => this.worker.runOnce(requestId)).catch(() => undefined);
    return { accepted: true, deduped: false };
  }

  idle() {
    return this.tail;
  }
}
