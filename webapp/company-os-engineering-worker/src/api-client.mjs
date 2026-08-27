import { signedHeaders } from './signing.mjs';

const PREFIX = '/api/company-os/engineering/v2';

export class EngineeringApiError extends Error {
  constructor(message, { code = 'ENGINEERING_API_ERROR', status = 0, retryable = false, uncertain = false } = {}) {
    super(message);
    this.name = 'EngineeringApiError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.uncertain = uncertain;
  }
}

function identity(claim) {
  return {
    missionId: claim.mission.missionId,
    leaseId: claim.lease.leaseId,
    fencingToken: claim.lease.fencingToken,
  };
}

export class EngineeringApiClient {
  constructor({ baseUrl, secret, workerId, instanceId, fetchImpl = globalThis.fetch, timeoutMs = 15_000, now = Date.now, nonceFactory }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.secret = secret;
    this.workerId = workerId;
    this.instanceId = instanceId;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.now = now;
    this.nonceFactory = nonceFactory;
  }

  async post(path, payload = {}) {
    const rawBody = JSON.stringify({ ...payload, workerId: this.workerId, instanceId: this.instanceId });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    timer.unref?.();
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${PREFIX}/${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...signedHeaders({
            secret: this.secret,
            workerId: this.workerId,
            rawBody,
            nowMs: this.now(),
            ...(this.nonceFactory ? { nonce: this.nonceFactory() } : {}),
          }),
        },
        body: rawBody,
        signal: controller.signal,
        redirect: 'error',
      });
      if (response.status === 204) return null;
      const text = await response.text();
      let body = {};
      if (text) {
        try { body = JSON.parse(text); } catch { throw new EngineeringApiError('ENGINEERING_API_INVALID_JSON'); }
      }
      if (!response.ok) {
        throw new EngineeringApiError(`ENGINEERING_API_HTTP_${response.status}`, {
          status: response.status,
          code: typeof body.code === 'string' ? body.code : 'ENGINEERING_API_HTTP_ERROR',
          retryable: [408, 409, 425, 429].includes(response.status) || response.status >= 500,
        });
      }
      return body;
    } catch (error) {
      if (error?.name === 'AbortError') throw new EngineeringApiError('ENGINEERING_API_TIMEOUT', { code: 'ENGINEERING_API_TIMEOUT', retryable: true, uncertain: true });
      if (error instanceof EngineeringApiError) throw error;
      throw new EngineeringApiError('ENGINEERING_API_NETWORK_ERROR', { code: 'ENGINEERING_API_NETWORK_ERROR', retryable: true, uncertain: true });
    } finally {
      clearTimeout(timer);
    }
  }

  claim() { return this.post('claim'); }
  heartbeat(claim, phase) { return this.post('heartbeat', { ...identity(claim), phase }); }
  transition(claim, toStatus, eventType, payload, idempotencyKey) {
    return this.post('transition', { ...identity(claim), toStatus, eventType, payload, idempotencyKey });
  }
  complete(claim, evidence) { return this.post('complete', { ...identity(claim), evidence }); }
  fail(claim, error) {
    return this.post('fail', {
      ...identity(claim),
      errorCode: error?.code || 'ENGINEERING_RUN_FAILED',
      retryable: error?.retryable === true,
    });
  }
  effect(action, claim, payload) { return this.post(`effect/${action}`, { ...identity(claim), ...payload }); }
}
