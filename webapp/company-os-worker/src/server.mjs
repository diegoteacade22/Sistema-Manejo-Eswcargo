import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.mjs';
import { CompanyOsApiClient } from './api-client.mjs';
import { OpenAiAdvisoryClient } from './openai-client.mjs';
import { OpenClawTelegramClient } from './notification-client.mjs';
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignedBody } from './signing.mjs';
import { CompanyOsWorker, SerialWebhookQueue } from './worker.mjs';

const MAX_BODY_BYTES = 1_048_576;

async function rawRequestBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('Body too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createWebhookServer({ queue, hmacSecret, signatureToleranceMs = 300_000, now = Date.now }) {
  return createServer(async (request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.method !== 'POST' || request.url !== '/webhook') {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    try {
      const rawBody = await rawRequestBody(request);
      const valid = verifySignedBody({
        secret: hmacSecret,
        timestamp: request.headers[TIMESTAMP_HEADER],
        signature: request.headers[SIGNATURE_HEADER],
        rawBody,
        nowMs: now(),
        toleranceMs: signatureToleranceMs,
      });
      if (!valid) {
        response.statusCode = 401;
        response.end(JSON.stringify({ error: 'Invalid signature' }));
        return;
      }

      let payload;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        response.statusCode = 400;
        response.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }
      if (typeof payload.requestId !== 'string' || !/^[A-Za-z0-9._:-]{1,200}$/.test(payload.requestId)) {
        response.statusCode = 400;
        response.end(JSON.stringify({ error: 'Invalid requestId' }));
        return;
      }

      const result = queue.enqueue(payload.requestId);
      response.statusCode = 202;
      response.end(JSON.stringify(result));
    } catch (error) {
      response.statusCode = error?.status || 500;
      response.end(JSON.stringify({ error: response.statusCode === 413 ? 'Body too large' : 'Internal error' }));
    }
  });
}

export function buildRuntime(config, overrides = {}) {
  const api = overrides.api || new CompanyOsApiClient({
    baseUrl: config.apiBaseUrl,
    hmacSecret: config.hmacSecret,
    fetchImpl: overrides.fetchImpl,
  });
  const openai = overrides.openai || new OpenAiAdvisoryClient({
    apiKey: config.openAiApiKey,
    baseUrl: config.openAiBaseUrl,
    model: config.model,
    timeoutMs: config.openAiTimeoutMs,
    fetchImpl: overrides.fetchImpl,
  });
  const worker = new CompanyOsWorker({
    api,
    openai,
    notifier: overrides.notifier || new OpenClawTelegramClient({
      gatewayUrl: config.openClawGatewayUrl,
      gatewayToken: config.openClawGatewayToken,
      target: config.telegramTarget,
      botToken: config.telegramBotToken,
      fetchImpl: overrides.fetchImpl,
    }),
    heartbeatIntervalMs: config.heartbeatIntervalMs,
    onError: (error) => console.error('[company-os-v3-worker]', error?.message || 'background error'),
  });
  return { worker, queue: new SerialWebhookQueue({ worker, dedupeTtlMs: config.dedupeTtlMs }) };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const mode = argv[0] || 'serve';
  const config = loadConfig(env);
  const runtime = buildRuntime(config);

  if (mode === 'recover') {
    const result = await runtime.worker.runOnce(undefined);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (mode === 'schedule') {
    const result = await runtime.worker.api.schedule();
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (mode !== 'serve') throw new Error(`Unknown mode: ${mode}`);

  const server = createWebhookServer({
    queue: runtime.queue,
    hmacSecret: config.hmacSecret,
    signatureToleranceMs: config.signatureToleranceMs,
  });
  server.listen(config.port, config.host, () => {
    console.log(`Company OS V3 worker listening on ${config.host}:${config.port}`);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(error?.message || 'Worker startup failed');
    process.exitCode = 1;
  });
}
