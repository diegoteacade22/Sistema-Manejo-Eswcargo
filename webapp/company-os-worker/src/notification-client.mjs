export class OpenClawTelegramClient {
  constructor({ gatewayUrl, gatewayToken, target, botToken, fetchImpl = globalThis.fetch }) {
    this.gatewayUrl = gatewayUrl.replace(/\/$/, '');
    this.gatewayToken = gatewayToken;
    this.target = target;
    this.botToken = botToken;
    this.fetchImpl = fetchImpl;
  }

  async send(claim, output, requestStatus = 'AWAITING_REVIEW') {
    const systemsManager = claim.agentId === 'systems-manager-ai-v1';
    const message = [
      systemsManager ? 'Gerente de Sistemas AI · análisis listo' : 'Company OS V3 · análisis listo',
      `Caso: ${claim.requestId}`,
      `Resumen: ${output.summary}`,
      systemsManager ? `Riesgo confirmado: ${output.primaryConfirmedRisk}` : `Problema principal: ${output.primaryDataQualityProblem}`,
      systemsManager ? `Gap de cobertura: ${output.primaryCoverageGap}` : `Próximo paso: ${output.recommendedNextStep}`,
      `Estado: ${requestStatus} · ninguna acción fue ejecutada.`,
    ].join('\n');
    let response;
    let gatewayError;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
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
        args: { channel: 'telegram', to: this.target, message, idempotencyKey: `company-os-v3:${claim.agentId || 'general-manager-ai-v3'}:${claim.requestId}:completed` },
      }),
      signal: AbortSignal.timeout(15_000),
        });
        const raw = await response.text();
        let payload = {};
        try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = {}; }
        if (response.ok && payload.ok === true) return { status: 'DELIVERED', responseCode: response.status };
        gatewayError = new Error(`OpenClaw notification HTTP ${response.status}`);
      } catch (error) {
        gatewayError = error;
      }
    }

    const direct = await this.fetchImpl(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: this.target, text: message }),
      signal: AbortSignal.timeout(15_000),
    });
    const directPayload = await direct.json().catch(() => ({}));
    if (!direct.ok || directPayload.ok !== true) {
      throw Object.assign(new Error(gatewayError?.message || `Telegram notification HTTP ${direct.status}`), { code: 'TELEGRAM_DELIVERY_FAILED' });
    }
    return { status: 'DELIVERED', responseCode: direct.status };
  }
}
