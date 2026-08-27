# Aprendizajes de Company OS

## LEARN-013 — La autoridad debe quedar ligada a la misión y probarse fuera del modelo

- Síntoma: una misión A1 podía heredar verbos A2, admitir traversal, cortar el loop antes de tres muestras o esconder un veto de merge detrás de idempotencia.
- Causa: autonomía, paths, repetición y vetos se evaluaban sin todos sus límites o en un orden ambiguo.
- Corrección: ligar autonomía al hash de misión, normalizar paths, exigir tres fingerprints y ejecutar vetos productivos antes del replay.
- Prueba: 92 tests, ejecución real `PASS_A1_LOCAL`, diff independiente, commit local acotado y ledger hash-linked de nueve eventos.
- Reutilización: sin credencial dedicada y readback externo, el tablero muestra `UNOBSERVED` y la operación continua permanece deshabilitada.

## LEARN-001 — Un parser de ofertas no es el Gerente General

- Síntoma: el Agente de Ingesta se presentaba como primer agente empresarial.
- Causa: se confundió una automatización especializada con orquestación ejecutiva.
- Corrección: promover un Gerente General AI read-only que cruza dominios y delega por área.
- Prueba: `/company-os` produce máximo cinco prioridades desde un snapshot live.
- Reutilización: distinguir siempre automatización, especialista y agente orquestador.

## LEARN-002 — Build local no prueba un agente productivo

- Síntoma: tests y diseño offline podían parecer operación real.
- Causa: faltaban modelo, fuente live, autenticación, deploy y readback.
- Corrección: exigir provider OpenAI, response ID, snapshot ID, ruta autenticada y verificación productiva.
- Prueba: contrato de cierre documentado en `README.md`.
- Reutilización: todo agente debe probar cada frontera del flujo real.

## LEARN-003 — Fallback útil debe declarar que no es AI

- Síntoma: una heurística podría ocultar un fallo del modelo.
- Causa: el resultado no distinguía provider ni degradación.
- Corrección: etiquetar `deterministic-fallback`, devolver HTTP 207 y mostrar warning.
- Prueba: `tests/company-os-general-manager.test.ts`.
- Reutilización: cualquier agente con degradación debe exponer su modo real.

## LEARN-004 — Orquestación sin memoria no permite seguimiento

- Síntoma: el brief desaparecía al recargar la página.
- Causa: el primer corte no tenía bitácora durable.
- Corrección: persistir `CompanyAgentRun` con clave idempotente y readback inmediato.
- Prueba: migración, hash estable y header `X-Company-OS-Run`.
- Reutilización: todo agente coordinador necesita estado auditable sin alterar datos de negocio.

## LEARN-005 — El texto del modelo no es evidencia

- Síntoma: un JSON válido podía incluir cifras inventadas o marcar `READY` sin una fuente fresca.
- Causa: evidencia y estado pertenecían al modelo.
- Corrección: el modelo solo selecciona referencias cerradas; el servidor materializa valores y calcula el estado.
- Prueba: tests adversariales de evidencia y ausencia de `SyncRun`.
- Reutilización: campos de control y evidencia deben ser propiedad del servidor.

## LEARN-006 — La llamada AI no debe vivir dentro de una transacción

- Síntoma: una llamada de hasta 120 segundos retenía conexión y advisory lock.
- Causa: idempotencia y generación estaban acopladas en una misma transacción.
- Corrección: reservar con lease, confirmar, llamar OpenAI fuera y persistir/readback en otra transacción corta.
- Prueba: `CompanyAgentRequest` registra intentos y serializa el rate limit por actor.
- Reutilización: separar reserva, trabajo remoto y commit durable.

## LEARN-007 — Fuente existente no prueba cobertura

- Síntoma: cero gastos o cero ofertas podían mostrarse como hechos aunque la última evidencia fuera vieja o inexistente.
- Causa: se confundía una consulta exitosa con partición fresca y completa.
- Corrección: perfilar filas, fecha máxima, frescura, cobertura, moneda y confianza; cero sin evidencia abre un gap.
- Prueba: `tests/company-os-calibration.test.ts` y readback productivo de perfiles.
- Reutilización: todo cero crítico necesita evidencia positiva de cobertura.

## LEARN-008 — La aprobación no debe mutar la propuesta original

- Síntoma: actualizar el estado de una misión rompería la bitácora append-only y ocultaría revisiones.
- Causa: se modelaba la decisión como atributo mutable.
- Corrección: proyectar estado y revisión efectiva desde `CompanyAgentMissionEvent`, con secuencia, hash e idempotencia.
- Prueba: `tests/company-os-mission-events.test.ts`.
- Reutilización: decisiones humanas sensibles deben conservar propuesta, revisión y actor como eventos inmutables.

## LEARN-009 — Una vista segura también debe probar precisión y costo real

- Síntoma: el primer cruce de ofertas tenía cero coincidencias históricas y las vistas recorrían datos fuera de la ventana accionable.
- Causa: se usó igualdad contra una descripción completa y el filtro temporal quedaba fuera de la vista.
- Corrección: resolver sólo identificadores exactos con un único producto y filtrar 24 h/30 días antes de normalizar; contar ítems de envío tanto directos como vía pedido.
- Prueba: migraciones forward-only, readback productivo dentro de 10 segundos y revisión independiente de los cuatro bloqueantes.
- Reutilización: una fuente derivada debe demostrar precisión, cobertura, rendimiento y ambigüedad cero antes de alimentar prioridades.

## LEARN-010 — Append-only requiere cabeza de cadena en la base

- Síntoma: el endpoint serializaba eventos, pero una inserción SQL directa podía declarar una cabeza falsa.
- Causa: la integridad dependía sólo del código de aplicación.
- Corrección: un trigger con advisory lock valida secuencia, expectedHead, previousHash y fromStatus contra la proyección persistida.
- Prueba: PostgreSQL rechazó una bifurcación con SQLSTATE 23514 y no dejó filas residuales.
- Reutilización: concurrencia e integridad de auditoría deben tener una barrera en la base además del readback de aplicación.

## LEARN-011 — Persistir antes de entregar elimina el webhook como punto único de falla

- Síntoma: una indisponibilidad entre Vercel y Hostinger podía dejar una orden sin procesar.
- Causa: la activación inmediata se trataba como garantía de entrega.
- Corrección: persist-before-deliver, registro del fallo, recovery periódico sólo sobre `QUEUED` o lease vencido y claim idempotente por `requestId`.
- Prueba: webhook fallido recuperado sin llamada OpenAI cuando la cola está vacía y sin doble procesamiento.
- Reutilización: todo trabajo remoto durable necesita cola persistente, lease y recuperación independiente del canal rápido.

## LEARN-012 — El cierre exige readback del camino real

- Síntoma: el pooler y la primera notificación parecían configurados, pero el cluster Supavisor incorrecto rechazaba el rol y OpenClaw agotó el timeout de entrega.
- Causa: presencia de variables y endpoints no demuestra conectividad ni recepción.
- Corrección: validar el cluster con autenticación real, conservar reintentos append-only y exigir readback de estado, consumo, Telegram, RLS y contadores DML.
- Prueba: caso `f22a12f2-61d5-4e0c-b169-9482bdd95068`, Telegram `messageId=3316`, intento 2 `DELIVERED`, cero locks/leases activos y cero cambios DML empresariales.
- Reutilización: ningún frente de agentes se congela por configuración; se congela sólo por evidencia del recorrido productivo completo.
