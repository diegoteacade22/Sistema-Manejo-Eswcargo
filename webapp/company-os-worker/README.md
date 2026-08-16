# Company OS V3 Worker

Worker Node.js puro para Hostinger. Tiene dos modos exclusivos:

- `serve`: escucha `POST /webhook`, valida HMAC y procesa webhooks con concurrencia 1.
- `recover`: reclama como máximo un caso sin enviar `requestId`; un `204` termina sin llamar OpenAI. El timer repite esta ejecución.

El servicio webhook y el timer de recovery deben quedar habilitados simultáneamente. La API conserva la autoridad final sobre lease e idempotencia; el mapa en memoria del webhook sólo evita reclamos duplicados dentro del mismo proceso.

## Variables

```dotenv
COMPANY_OS_V3_API_BASE_URL=https://app.example.com
COMPANY_OS_V3_HMAC_SECRET=replace-me
OPENAI_API_KEY=replace-me
COMPANY_OS_V3_MODEL=gpt-5.6-sol
COMPANY_OS_V3_HOST=127.0.0.1
PORT=8787
COMPANY_OS_V3_SIGNATURE_TOLERANCE_MS=300000
COMPANY_OS_V3_OPENAI_TIMEOUT_MS=120000
COMPANY_OS_V3_HEARTBEAT_INTERVAL_MS=30000
COMPANY_OS_V3_DEDUPE_TTL_MS=3600000
COMPANY_OS_V3_OPENCLAW_GATEWAY_URL=http://host.docker.internal:42691
COMPANY_OS_V3_OPENCLAW_GATEWAY_TOKEN=secretref-resolved-at-deploy
COMPANY_OS_V3_TELEGRAM_TARGET=authorized-chat-id
```

No guardar el archivo de entorno en el repositorio. Restringirlo al usuario del servicio.

## Firma HMAC

Entradas y llamadas salientes usan:

- `X-Company-OS-Timestamp`: Unix timestamp de 10 dígitos, en segundos.
- `X-Company-OS-Signature`: `sha256=<hex>`.
- mensaje firmado: `${timestamp}.${rawBody}`.
- tolerancia de entrada: 5 minutos por defecto.

Todas las llamadas del worker a `/api/company-os/v3/worker/*` se firman sobre el JSON exacto enviado.

## Flujo

1. Webhook válido encola un `requestId`; duplicados recientes reciben `202` con `deduped: true`.
2. El worker llama una vez a `POST /api/company-os/v3/worker/claim`. Recovery envía `{}`; webhook envía `{ "requestId": "..." }`.
3. `204` cierra el intento. Un claim debe incluir `leaseToken`, `requestId`, `caseId`, `objective` y `evidencePayload` ya seleccionado.
4. Mientras OpenAI procesa, se envían heartbeats periódicos.
5. Responses API usa `store:false`, reasoning `low`, máximo 3000 tokens, timeout 120 s y un único reintento para errores transitorios.
6. Éxito envía output advisory estricto y el objeto `usage` completo a `complete`. Error envía código/mensaje seguro y `retryable` a `fail`.
7. Tras persistir el resultado, notifica al chat Telegram autorizado mediante el endpoint OpenClaw existente y registra la entrega; un fallo de Telegram no revierte el análisis.

El worker no consulta bases de datos ni selecciona evidencia. Las misiones generadas sólo pueden quedar `PLANNED`.

## Pruebas locales

```bash
cd webapp/company-os-worker
npm test
```

Las pruebas usan servidores/fetch locales simulados; no llaman producción ni OpenAI.

## Hostinger

Copiar exclusivamente esta carpeta a `/opt/company-os-v3-worker`, crear el usuario `company-os` y el archivo `/etc/company-os-v3-worker.env`. Luego habilitar ambos mecanismos:

```bash
# Webhook continuo
sudo cp systemd/company-os-v3-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now company-os-v3-worker.service

# Polling recover cada minuto, en paralelo con el webhook
sudo cp systemd/company-os-v3-recover.service systemd/company-os-v3-recover.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now company-os-v3-recover.timer
```

El puerto queda ligado a `127.0.0.1` en Compose; publicar `/webhook` mediante el reverse proxy TLS existente.
