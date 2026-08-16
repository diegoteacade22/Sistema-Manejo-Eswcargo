import { signedHeaders } from './signing.mjs';

export class WorkerApiError extends Error {
  constructor(message, { status = 0, retryable = false, code = 'WORKER_API_ERROR' } = {}) {
    super(message);
    this.name = 'WorkerApiError';
    this.status = status;
    this.retryable = retryable;
    this.code = code;
  }
}

export class CompanyOsApiClient {
  constructor({ baseUrl, hmacSecret, fetchImpl = globalThis.fetch, now = Date.now }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.hmacSecret = hmacSecret;
    this.fetchImpl = fetchImpl;
    this.now = now;
  }

  async post(path, payload) {
    const rawBody = JSON.stringify(payload);
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...signedHeaders(this.hmacSecret, rawBody, this.now()),
      },
      body: rawBody,
    });

    if (response.status === 204) return null;
    if (!response.ok) {
      let detail = '';
      try {
        const body = await response.json();
        detail = typeof body?.error === 'string' ? `: ${body.error.slice(0, 300)}` : '';
      } catch {}
      throw new WorkerApiError(`Company OS API returned HTTP ${response.status}${detail}`, {
        status: response.status,
        retryable: response.status === 429 || response.status >= 500,
        code: 'COMPANY_OS_API_HTTP_ERROR',
      });
    }

    try {
      const text = await response.text();
      if (!text) return {};
      return JSON.parse(text);
    } catch {
      throw new WorkerApiError('Company OS API returned invalid JSON', { code: 'COMPANY_OS_API_INVALID_JSON' });
    }
  }

  claim(requestId) {
    const payload = requestId === undefined ? {} : { requestId };
    return this.post('/api/company-os/v3/worker/claim', payload);
  }

  heartbeat(claim) {
    return this.post('/api/company-os/v3/worker/heartbeat', {
      leaseToken: claim.leaseToken,
      requestId: claim.requestId,
      caseId: claim.caseId,
    });
  }

  complete(claim, output, usage) {
    return this.post('/api/company-os/v3/worker/complete', {
      leaseToken: claim.leaseToken,
      requestId: claim.requestId,
      caseId: claim.caseId,
      output,
      usage,
    });
  }

  fail(claim, error) {
    return this.post('/api/company-os/v3/worker/fail', {
      leaseToken: claim.leaseToken,
      requestId: claim.requestId,
      caseId: claim.caseId,
      error,
    });
  }

  notification(claim, delivery) {
    return this.post('/api/company-os/v3/worker/notification', {
      leaseToken: claim.leaseToken,
      requestId: claim.requestId,
      caseId: claim.caseId,
      delivery,
    });
  }
}
