import { WorkerApiError } from './api-client.mjs';
import { runtimeSignedHeaders } from './runtime-signing.mjs';

const RUNTIME_API_PREFIX = '/api/company-os/runtime/v1';

function claimIdentity(claim) {
  return {
    leaseToken: claim.leaseToken,
    requestId: claim.requestId,
    caseId: claim.caseId,
    workItemId: claim.workItemId,
    attemptId: claim.attemptId,
    agentId: claim.agentId,
    slotNo: claim.slotNo,
    leaseInstanceId: claim.leaseInstanceId,
  };
}

export class CompanyOsRuntimeApiClient {
  constructor({ baseUrl, hmacSecret, workerId, instanceId, fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 15_000, nonceFactory }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.hmacSecret = hmacSecret;
    this.workerId = workerId;
    this.instanceId = instanceId;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.timeoutMs = timeoutMs;
    this.nonceFactory = nonceFactory;
  }

  async post(endpoint, payload = {}, workerId = this.workerId) {
    const body = { ...payload, workerId, instanceId: this.instanceId };
    const rawBody = JSON.stringify(body);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    timeout.unref?.();
    try {
      const headers = runtimeSignedHeaders({
        secret: this.hmacSecret,
        workerId,
        rawBody,
        nowMs: this.now(),
        ...(this.nonceFactory ? { nonce: this.nonceFactory() } : {}),
      });
      const response = await this.fetchImpl(`${this.baseUrl}${RUNTIME_API_PREFIX}/${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: rawBody,
        signal: controller.signal,
        redirect: 'error',
      });
      if (response.status === 204) return null;
      if (!response.ok) {
        let detail = '';
        try {
          const responseBody = await response.json();
          detail = typeof responseBody?.error === 'string' ? `: ${responseBody.error.slice(0, 300)}` : '';
        } catch {}
        throw new WorkerApiError(`Company OS Runtime API returned HTTP ${response.status}${detail}`, {
          status: response.status,
          retryable: response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500,
          code: 'COMPANY_OS_RUNTIME_API_HTTP_ERROR',
        });
      }
      const text = await response.text();
      if (!text) return {};
      try {
        return JSON.parse(text);
      } catch {
        throw new WorkerApiError('Company OS Runtime API returned invalid JSON', { code: 'COMPANY_OS_RUNTIME_API_INVALID_JSON' });
      }
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new WorkerApiError('Company OS Runtime API timed out', { retryable: true, code: 'COMPANY_OS_RUNTIME_API_TIMEOUT' });
      }
      if (error instanceof WorkerApiError) throw error;
      throw new WorkerApiError('Company OS Runtime API network request failed', { retryable: true, code: 'COMPANY_OS_RUNTIME_API_NETWORK_ERROR' });
    } finally {
      clearTimeout(timeout);
    }
  }

  claim() {
    return this.post('claim');
  }

  heartbeat(claim, phase = 'RUNNING') {
    return this.post('heartbeat', { ...claimIdentity(claim), phase });
  }

  complete(claim, output, usage) {
    return this.post('complete', { ...claimIdentity(claim), output, usage }, claim.workerId || this.workerId);
  }

  resultStatus(claim) {
    return this.post('result-status', claimIdentity(claim), claim.workerId || this.workerId);
  }

  fail(claim, error) {
    return this.post('fail', {
      ...claimIdentity(claim),
      errorCode: error?.code || error?.errorCode || 'RUNTIME_FAILURE',
      detail: error?.message || error?.detail || 'Runtime failure',
      retryable: error?.retryable === true,
      ...(error?.code === 'MODEL_ROUTER_FALLBACK_FAILED' ? {
        primaryCode: error.primaryCode,
        fallbackCode: error.fallbackCode,
        retries: error.retries,
        durationMs: error.durationMs,
      } : {}),
      ...(error?.usage ? { usage: error.usage } : {}),
    });
  }

  workerHeartbeat(snapshot) {
    return this.post('worker-heartbeat', snapshot);
  }

  reconcile() {
    return this.post('reconcile');
  }

  schedule() {
    return this.post('schedule');
  }
}
