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
    const response = await this.fetchImpl(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: this.target, text: message }),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok !== true) throw Object.assign(new Error(`Telegram notification HTTP ${response.status}`), { code: 'TELEGRAM_DELIVERY_FAILED' });
    return { status: 'DELIVERED', responseCode: response.status };
  }
}
