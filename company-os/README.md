# Company OS — Gerente General AI V3

Estado: **FROZEN / CLOSED** desde 2026-08-16. Producción advisory-only, datos
empresariales estrictamente read-only. No se abre una V4 desde este frente.

## Arquitectura operativa

1. `POST /api/company-os/v3/cases` autentica un ADMIN, materializa evidencia y persiste caso, orden y evento `QUEUED`.
2. Recién después intenta el webhook HMAC a Hostinger. El resultado de entrega se registra aun cuando falle.
3. El worker reclama por `requestId`; un timer systemd ejecuta recovery cada 60 segundos sin `requestId` y recibe `204` si no hay trabajo.
4. La API entrega casos `QUEUED`, `ANALYZING` con lease vencido o `FAILED` con un único reintento disponible. Lock, lease, heartbeat y constraints evitan doble procesamiento.
5. El worker llama Responses API con `store=false`, `gpt-5.6-sol`, reasoning low, timeout 120 s, `max_output_tokens=3000` y un único reintento.
6. La API valida referencias cerradas, persiste resultado, consumo y misiones `PLANNED`, y mueve la solicitud a `AWAITING_REVIEW` o `COMPLETED`.
7. OpenClaw entrega Telegram al único chat autorizado y la API registra el readback de la entrega.

## Estados separados

- Solicitudes: `QUEUED`, `ANALYZING`, `AWAITING_REVIEW`, `BLOCKED`, `FAILED`, `CANCELLED`, `COMPLETED`.
- Misiones: `PLANNED`, `APPROVED`, `REJECTED`, `REVIEW`, `BLOCKED`, `RUNNING`, `DONE`.

V3 no expone transición alguna a `RUNNING` o `DONE`. Aprobar una misión conserva `executionAuthorized=false`.

## Presupuesto

- concurrencia: 1;
- reintentos del modelo: 1;
- timeout: 120 segundos;
- salida máxima: 3.000 tokens;
- objetivo total por solicitud: 12.000 tokens;
- presupuesto estimado de entrada: 9.000 tokens;
- alertas: 70 %, 85 % y 100 %.

Se guardan por separado entrada, cacheados, cache-write, salida, razonamiento, total, costo estimado y acumulado diario. Si el snapshot excede el presupuesto, se selecciona evidencia de forma determinística conservando métricas, gaps y frescura; si aun así no entra, el caso se bloquea antes de OpenAI.

## Escrituras permitidas

Sólo en tablas internas de Company OS: casos, mensajes, eventos, decisiones, auditoría, consumo, locks, leases, heartbeats, intentos de ejecución, entregas de notificaciones, misiones y referencias de evidencia. Ninguna tabla operativa empresarial recibe `INSERT`, `UPDATE` o `DELETE`.

El rol de permisos `company_os_v3` nace `NOLOGIN` en la migración. Producción lo habilita con una credencial generada fuera del repositorio, guardada como `COMPANY_OS_V3_DATABASE_URL`; el gate exige readback de `current_user=company_os_v3`, DML interno permitido y DML empresarial denegado.

## Verificación

```bash
cd webapp
npm run test:company-os
npm run build
cd company-os-worker && npm test
```

La prueba productiva canónica y única está documentada en `PRODUCTION_TEST_V3.md`. El rollback está en `V3_ROLLBACK.md`.

Cierre verificado: recorrido `QUEUED → ANALYZING → AWAITING_REVIEW`, webhook
fallido recuperado, dos intentos máximos, Telegram entregado, RLS forzado,
permisos empresariales de escritura en cero y contadores DML empresariales sin
cambios respecto del baseline.
