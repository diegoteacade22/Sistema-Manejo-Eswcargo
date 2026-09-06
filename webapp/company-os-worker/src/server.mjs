import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.mjs';
import { CompanyOsApiClient } from './api-client.mjs';
import { createJsonLogger } from './json-logger.mjs';
import { OpenAiAdvisoryClient } from './openai-client.mjs';
import { OllamaAdvisoryClient, RetryableModelFallbackClient } from './ollama-client.mjs';
import { requiresLocalInference } from './data-policy.mjs';
import { TelegramNotificationClient } from './notification-client.mjs';
import { CompanyOsRuntimeApiClient } from './runtime-api-client.mjs';
import { loadRuntimeConfig, validateLocalLineageModel } from './runtime-config.mjs';
import { CompanyOsRuntimeDaemon } from './runtime-daemon.mjs';
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
    if (request.method === 'GET' && request.url === '/health') {
      response.statusCode = 200;
      response.end(JSON.stringify({ ok: true, service: 'company-os-v3-worker', contract: 'systems-manager-ai-v1', version: 1 }));
      return;
    }
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
    notifier: overrides.notifier || new TelegramNotificationClient({
      target: config.telegramTarget,
      botToken: config.telegramBotToken,
      fetchImpl: overrides.fetchImpl,
    }),
    heartbeatIntervalMs: config.heartbeatIntervalMs,
    onError: (error) => console.error('[company-os-v3-worker]', error?.message || 'background error'),
  });
  return { worker, queue: new SerialWebhookQueue({ worker, dedupeTtlMs: config.dedupeTtlMs }) };
}

export function buildDaemonRuntime(config, overrides = {}) {
  const instanceId = overrides.instanceId || randomUUID();
  const logger = overrides.logger || createJsonLogger(config);
  const api = overrides.api || new CompanyOsRuntimeApiClient({
    baseUrl: config.apiBaseUrl,
    hmacSecret: config.hmacSecret,
    workerId: config.workerId,
    instanceId,
    timeoutMs: config.apiTimeoutMs,
    fetchImpl: overrides.fetchImpl,
  });
  const openai = overrides.openai || (() => {
    const localData = new OllamaAdvisoryClient({
      baseUrl: config.ollamaBaseUrl,
      model: validateLocalLineageModel(config.localLineageModel),
      timeoutMs: config.ollamaTimeoutMs,
      requireClaimOutputSchema: true,
      fetchImpl: overrides.fetchImpl,
    });
    const routed = new RetryableModelFallbackClient({
      enabled: config.ollamaFallbackEnabled,
      primary: new OpenAiAdvisoryClient({
        apiKey: config.openAiApiKey,
        baseUrl: config.openAiBaseUrl,
        model: config.model,
        timeoutMs: config.openAiTimeoutMs,
        requireClaimOutputSchema: true,
        fetchImpl: overrides.fetchImpl,
      }),
      fallback: new OllamaAdvisoryClient({
        baseUrl: config.ollamaBaseUrl,
        model: config.ollamaModel,
        timeoutMs: config.ollamaTimeoutMs,
        requireClaimOutputSchema: true,
        fetchImpl: overrides.fetchImpl,
      }),
    });
    const routeGenerate = routed.generate.bind(routed);
    return Object.assign(routed, {
      generate(claim, options = {}) {
        return requiresLocalInference(claim)
          ? localData.generate(claim, options)
          : routeGenerate(claim, options);
      },
    });
  })();
  const notifier = overrides.notifier !== undefined
    ? overrides.notifier
    : null;
  const processor = overrides.processor || new CompanyOsWorker({
    api,
    openai,
    notifier,
    heartbeatIntervalMs: config.leaseHeartbeatIntervalMs,
    failClosedInitialHeartbeat: true,
    onError: (error) => logger.error('CLAIM_BACKGROUND_ERROR', { code: error?.code || 'UNKNOWN', message: error?.message || 'Background error' }),
  });
  const daemon = new CompanyOsRuntimeDaemon({
    config,
    api,
    processor,
    logger,
    instanceId,
    lock: overrides.lock,
    healthServerFactory: overrides.healthServerFactory,
    now: overrides.now,
    sleep: overrides.sleep,
  });
  return { daemon, api, processor, logger, instanceId };
}

async function runDaemon(env) {
  const config = loadRuntimeConfig(env);
  const runtime = buildDaemonRuntime(config);
  await runtime.daemon.start();
  let stopping = false;
  const shutdown = async (signal) => {
    if (stopping) process.exit(1);
    stopping = true;
    const forceExit = setTimeout(() => process.exit(1), config.shutdownGraceMs + 15_000);
    const result = await runtime.daemon.stop(signal);
    clearTimeout(forceExit);
    process.exit(result.drained ? 0 : 1);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
  return runtime;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const mode = argv[0] || 'serve';
  if (mode === 'daemon') return runDaemon(env);
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
