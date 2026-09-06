import { redactExternalText, redactExternalValue } from './redaction.mjs';
import { completionEntry } from './completion-outbox.mjs';

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
  const failure = { code, message, retryable: error?.retryable === true };
  if (code === 'MODEL_ROUTER_FALLBACK_FAILED') {
    failure.primaryCode = typeof error?.primaryCode === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.primaryCode)
      ? error.primaryCode : 'OPENAI_UNKNOWN_ERROR';
    failure.fallbackCode = typeof error?.fallbackCode === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.fallbackCode)
      ? error.fallbackCode : 'OLLAMA_UNKNOWN_ERROR';
    failure.retries = Number.isSafeInteger(error?.retries) && error.retries >= 0 ? error.retries : 0;
    failure.durationMs = Number.isSafeInteger(error?.durationMs) && error.durationMs >= 0 ? error.durationMs : 0;
  }
  return failure;
}

export class CompanyOsWorker {
  constructor({ api, openai, notifier = null, heartbeatIntervalMs = 30_000, failClosedInitialHeartbeat = false, outbox = null, onError = () => {} }) {
    this.api = api;
    this.outbox = outbox;
    this.delivering = new Set();
    this.drainingCompletions = null;
    this.openai = openai;
    this.notifier = notifier;
    this.heartbeatIntervalMs = heartbeatIntervalMs;
    this.failClosedInitialHeartbeat = failClosedInitialHeartbeat;
    this.onError = onError;
  }

  get pendingCompletionCount() { return this.outbox?.pendingCount || 0; }
  get persistenceBlocked() { return this.outbox?.blocked === true; }

  pendingResult(claim, code = 'COMPLETION_PENDING') {
    return { status: 'PERSISTENCE_PENDING', requestId: claim.requestId, caseId: claim.caseId,
      error: { code, message: 'Result retained; waiting for persistence confirmation', retryable: true } };
  }

  async deliverCompletion(entry, { replay = false } = {}) {
    const key = entry.claim.attemptId;
    if (this.delivering.has(key)) return this.pendingResult(entry.claim);
    this.delivering.add(key);
    const confirm = async () => {
      const receipt = await this.api.resultStatus(entry.claim);
      if (!['COMPLETED', 'SUPERSEDED'].includes(receipt?.state)) return null;
      if (receipt.resultHash !== entry.resultHash) throw Object.assign(new Error('Completion receipt hash differs'), { code: 'COMPLETION_HASH_MISMATCH' });
      this.outbox.acknowledge(entry);
      return { status: receipt.state, requestId: entry.claim.requestId, caseId: entry.claim.caseId,
        modelProvider: entry.usage.provider === 'ollama' ? 'ollama' : 'openai',
        model: typeof entry.usage.model === 'string' ? entry.usage.model : null,
        fallbackReason: typeof entry.usage.fallback_reason === 'string' ? entry.usage.fallback_reason : null };
    };
    try {
      if (replay) {
        const confirmed = await confirm();
        if (confirmed) return confirmed;
      }
      for (let attempt = 0; attempt < 2; attempt += 1) {
        // A failed transport is ambiguous. Never report fail or discard the generated result.
        try { await this.api.complete(entry.claim, entry.output, entry.usage); } catch {}
        const confirmed = await confirm();
        if (confirmed) return confirmed;
      }
      return this.pendingResult(entry.claim);
    } catch (error) {
      // Do not forward transport text: it may echo the signed payload or model result.
      return this.pendingResult(entry.claim, error?.code === 'COMPLETION_HASH_MISMATCH' ? error.code : 'COMPLETION_PENDING');
    } finally { this.delivering.delete(key); }
  }

  async drainCompletions() {
    if (!this.outbox) return { pending: 0, blocked: false };
    if (this.drainingCompletions) return this.drainingCompletions;
    this.drainingCompletions = (async () => {
      try {
        const entries = this.outbox.load();
        for (const entry of entries) {
          if (this.delivering.has(entry.claim.attemptId)) continue;
          this.outbox.persist(entry);
          await this.deliverCompletion(entry, { replay: true });
        }
      } catch { /* outbox retains memory and sets a fail-closed flag */ }
      return { pending: this.pendingCompletionCount, blocked: this.persistenceBlocked };
    })();
    try { return await this.drainingCompletions; } finally { this.drainingCompletions = null; }
  }

  async runOnce(requestId) {
    const claim = await this.api.claim(requestId);
    if (claim === null) return { status: 'NO_CONTENT' };
    return this.runClaim(claim);
  }

  async runClaim(claim, { signal: shutdownSignal } = {}) {
    assertClaim(claim);
    if (this.outbox) {
      try { if (!this.outbox.loaded) this.outbox.load(); } catch { return this.pendingResult(claim, 'COMPLETION_OUTBOX_UNAVAILABLE'); }
      if (this.persistenceBlocked) return this.pendingResult(claim);
    }
    let generatedUsage = null;
    let generatedEntry = null;
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
      generatedUsage = usage;
      if (this.outbox) {
        clearInterval(interval);
        generatedEntry = completionEntry(claim, output, usage, this.api);
        this.outbox.persist(generatedEntry);
        return await this.deliverCompletion(generatedEntry);
      }
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
      return {
        status: 'COMPLETED',
        requestId: claim.requestId,
        caseId: claim.caseId,
        modelProvider: usage.provider === 'ollama' ? 'ollama' : 'openai',
        model: typeof usage.model === 'string' ? usage.model : null,
        fallbackReason: typeof usage.fallback_reason === 'string' ? usage.fallback_reason : null,
      };
    } catch (error) {
      if (generatedEntry) return this.pendingResult(claim, 'COMPLETION_OUTBOX_UNAVAILABLE');
      const reportedError = leaseFailure ?? error;
      const failure = {
        ...safeFailure(reportedError),
        ...((generatedUsage || error?.usage) && typeof (generatedUsage || error?.usage) === 'object' ? { usage: generatedUsage || error.usage } : {}),
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
