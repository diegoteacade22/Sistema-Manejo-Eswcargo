export class OpenClawTelegramClient {
  constructor({ gatewayUrl, gatewayToken, target, fetchImpl = globalThis.fetch }) {
    this.gatewayUrl = gatewayUrl.replace(/\/$/, '');
    this.gatewayToken = gatewayToken;
    this.target = target;
    this.fetchImpl = fetchImpl;
  }

  async send(claim, output, requestStatus = 'AWAITING_REVIEW') {
    const message = [
      'Company OS V3 · análisis listo',
      `Caso: ${claim.requestId}`,
      `Resumen: ${output.summary}`,
      `Problema principal: ${output.primaryDataQualityProblem}`,
      `Próximo paso: ${output.recommendedNextStep}`,
      `Estado: ${requestStatus} · ninguna acción fue ejecutada.`,
    ].join('\n');
    let response;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      response = await this.fetchImpl(`${this.gatewayUrl}/tools/invoke`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.gatewayToken}`,
        'content-type': 'application/json',
        'x-openclaw-scopes': 'operator.write',
        'x-openclaw-message-channel': 'telegram',
        'x-openclaw-message-to': this.target,
      },
      body: JSON.stringify({
        tool: 'message', action: 'send',
        args: { channel: 'telegram', to: this.target, message, idempotencyKey: `company-os-v3:${claim.requestId}:completed` },
      }),
      signal: AbortSignal.timeout(15_000),
      });
      if (response.ok || attempt === 2) break;
    }
    const raw = await response.text();
    let payload = {};
    try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = {}; }
    if (!response.ok || payload.ok !== true) {
      throw Object.assign(new Error(`OpenClaw notification HTTP ${response.status}`), { code: 'TELEGRAM_DELIVERY_FAILED' });
    }
    return { status: 'DELIVERED', responseCode: response.status };
  }
}
