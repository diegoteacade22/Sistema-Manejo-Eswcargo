import { redactExternalText, redactExternalValue } from './redaction.mjs';

function assertClaim(claim) {
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
  constructor({ api, openai, notifier = null, heartbeatIntervalMs = 30_000, onError = () => {} }) {
    this.api = api;
    this.openai = openai;
    this.notifier = notifier;
    this.heartbeatIntervalMs = heartbeatIntervalMs;
    this.onError = onError;
  }

  async runOnce(requestId) {
    const claim = await this.api.claim(requestId);
    if (claim === null) return { status: 'NO_CONTENT' };
    assertClaim(claim);

    let heartbeatBusy = false;
    const heartbeat = async () => {
      if (heartbeatBusy) return;
      heartbeatBusy = true;
      try {
        await this.api.heartbeat(claim);
      } catch (error) {
        this.onError(error);
      } finally {
        heartbeatBusy = false;
      }
    };
    const interval = setInterval(() => void heartbeat(), this.heartbeatIntervalMs);
    interval.unref?.();

    try {
      await heartbeat();
      const { output, usage } = await this.openai.generate(claim);
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
      const failure = safeFailure(error);
      try {
        await this.api.fail(claim, failure);
      } catch (failError) {
        this.onError(failError);
      }
      return { status: 'FAILED', requestId: claim.requestId, caseId: claim.caseId, error: failure };
    } finally {
      clearInterval(interval);
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
