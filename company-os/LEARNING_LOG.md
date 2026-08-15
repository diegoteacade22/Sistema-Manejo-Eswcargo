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
