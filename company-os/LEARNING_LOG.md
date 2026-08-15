# Aprendizajes de Company OS

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
