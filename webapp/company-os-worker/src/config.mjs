function required(name, env) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveInteger(value, fallback, name) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

export function loadConfig(env = process.env) {
  const apiBaseUrl = required('COMPANY_OS_V3_API_BASE_URL', env).replace(/\/$/, '');
  new URL(apiBaseUrl);

  return Object.freeze({
    apiBaseUrl,
    hmacSecret: required('COMPANY_OS_V3_HMAC_SECRET', env),
    openAiApiKey: required('OPENAI_API_KEY', env),
    openAiBaseUrl: (env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/$/, ''),
    model: env.COMPANY_OS_V3_MODEL?.trim() || 'gpt-5.6-sol',
    host: env.COMPANY_OS_V3_HOST?.trim() || '127.0.0.1',
    port: positiveInteger(env.PORT, 8787, 'PORT'),
    signatureToleranceMs: positiveInteger(env.COMPANY_OS_V3_SIGNATURE_TOLERANCE_MS, 300_000, 'COMPANY_OS_V3_SIGNATURE_TOLERANCE_MS'),
    openAiTimeoutMs: positiveInteger(env.COMPANY_OS_V3_OPENAI_TIMEOUT_MS, 120_000, 'COMPANY_OS_V3_OPENAI_TIMEOUT_MS'),
    heartbeatIntervalMs: positiveInteger(env.COMPANY_OS_V3_HEARTBEAT_INTERVAL_MS, 30_000, 'COMPANY_OS_V3_HEARTBEAT_INTERVAL_MS'),
    dedupeTtlMs: positiveInteger(env.COMPANY_OS_V3_DEDUPE_TTL_MS, 3_600_000, 'COMPANY_OS_V3_DEDUPE_TTL_MS'),
    openClawGatewayUrl: required('COMPANY_OS_V3_OPENCLAW_GATEWAY_URL', env).replace(/\/$/, ''),
    openClawGatewayToken: required('COMPANY_OS_V3_OPENCLAW_GATEWAY_TOKEN', env),
    telegramTarget: required('COMPANY_OS_V3_TELEGRAM_TARGET', env),
    telegramBotToken: required('COMPANY_OS_V3_TELEGRAM_BOT_TOKEN', env),
  });
}
