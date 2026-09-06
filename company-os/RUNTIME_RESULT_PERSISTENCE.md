# Persistencia y recuperación de resultados

El worker guarda el resultado saneado y su consumo en `stateDir/completion-outbox`, con permisos 600, sincronización a disco y renombre atómico. Un fallo de `complete` conserva esa copia. El siguiente ciclo o reinicio transmite el mismo resultado; no ejecuta nuevamente el modelo. Mientras falta confirmación muestra `DEGRADED` y no reclama nuevas tareas.

`POST runtime/v1/complete` autentica el worker y la identidad histórica del intento. Guarda primero un receipt en el audit append-only existente, separado de la transacción que materializa mensajes, seguimiento y consumo. La cola excluye intentos con receipts pendientes. El reconciliador existente puede materializarlos aunque el worker original no vuelva.

`POST runtime/v1/result-status` confirma `COMPLETED` sólo cuando hay intento exitoso, mensaje, consumo y lease cerrado. Devuelve el hash del resultado para comprobar identidad. El estado del caso puede ser `NEEDS_REVIEW` aunque el trabajo esté completado. Los resultados tardíos reemplazados, cancelados o rechazados quedan archivados como `SUPERSEDED`, con consumo registrado, sin sobrescribir un sucesor ni ejecutar sus propuestas.

Un lease vencido sin intento posterior puede materializar su resultado guardado, sin incrementar `attemptCount`. `fail` no puede destruir un receipt. Un fallo de un trabajo tampoco cierra el caso si quedan hermanos en cola o reintentables. El reconciliador recupera casos históricos `FAILED_FINAL` sólo si siguen teniendo pendientes y la última transición de estado fue un fallo automático o vencimiento; respeta objetivos pausados o terminados.

La reserva y el consumo de un receipt no se suman dos veces. Si Ollama no informa contadores válidos, el error es `OLLAMA_USAGE_UNOBSERVED`: se contabiliza la reserva como estimación explícita mediante las reglas `tokens-are-reserved-estimate` y `accounting-reconciliation-required`. No se presenta un cero como consumo medido. La adaptación local no puede aumentar el máximo de salida del contrato.

## Validación e integración

- `npm run test:company-os` desde `webapp/` incluye pruebas transaccionales sintéticas: rollback posterior al receipt, replay/reinicio, vencimiento, identidad incorrecta, cancelación, caso bloqueado, revisión humana e idempotencia.
- `npm test` desde `webapp/company-os-worker/` incluye pruebas de disco y proceso separado: corte después de fsync, caída de API, respuestas perdidas, disco no disponible y recuperación de temporales.
- `npm run build` y `npx tsc --noEmit` desde `webapp/`.
- La migración `20260906230000_company_os_result_receipt_indexes.sql` sólo agrega índices parciales al audit existente. No crea una cola ni cambia tablas de negocio.
- `npx tsx scripts/readback-company-os-runtime.ts` usa la conexión del runtime ya configurada. Sólo lee metadatos de Company OS. No carga archivos secretos, devuelve prompts/resultados completos ni imprime tokens de lease.

Instalar API y worker desde una única integración. Conservar `stateDir` durante la actualización. Antes de declarar éxito productivo, verificar un resultado recibido y aplicado, replay sin otro intento, consumo único, lease y slot liberados y ausencia de pendientes técnicos recuperables. Las pruebas locales no sustituyen esa comprobación.

La garantía empieza al persistir la copia en disco o en el servidor. Si el disco está caído y se mata el proceso antes de guardar, la copia en memoria no puede sobrevivir. Resultados ya perdidos por versiones anteriores no se reconstruyen por esta corrección.
