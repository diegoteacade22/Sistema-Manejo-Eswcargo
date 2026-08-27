# Gerente de Sistemas AI — contrato congelado v1

- Identidad: `systems-manager-ai-v1` / “Gerente de Sistemas AI”.
- Área: `SYSTEMS`.
- Reporta a: `general-manager-ai-v3`.
- Autoridad: advisory-only. No ejecuta misiones, deploys, rollbacks, cambios de infraestructura, rotaciones, compras ni escrituras empresariales.
- Runtime: Company OS V3 común; Vercel API/UI, PostgreSQL Supabase, worker Hostinger, HMAC, locks, leases, heartbeat, recovery y bot de Telegram existentes.
- Modelo: Responses API, `store:false`, razonamiento low, timeout 120 s, un reintento, máximo 3000 tokens de salida y objetivo total 12000.
- Inventario: snapshots append-only con activos, salud, cobertura, dependencias, riesgos e historial. AWS permanece `ARCHIVED`; Mac mini permanece `FUTURE`.
- Evidencia: cerrada por caso, sin secretos. Falta de telemetría produce `UNOBSERVED` o `UNKNOWN`, nunca `OFFLINE_CONFIRMED`.
- Riesgos: clasificación determinística; máximo cinco `ACTION_REQUIRED`. El modelo sólo sintetiza IDs materializados.
- Agenda: registro genérico por `agentId`; baseline diario 08:00 `America/New_York`; semanal deshabilitado hasta que una revisión humana confirme valor.
- Notificación: intención durable antes del efecto externo, una única entrega por el bot de Telegram existente y resultado persistido por separado. Dedupe por agente, evento y fingerprint de evidencia; una entrega incierta no se reintenta automáticamente.
- Seguridad: ADMIN revalidado para humanos, HMAC para worker, rol dedicado `systems_manager_ai_v1` NOLOGIN y sin BYPASSRLS para lectura técnica/revisión de riesgos, RLS forzado, mínimo privilegio y auditoría append-only.

## Fuentes

Observadas en el snapshot: runtime Vercel, transacción PostgreSQL Company OS y liveness HTTP del worker Hostinger.

`UNOBSERVED`: APIs de proveedor GitHub, DNS, facturación Vercel, backups Supabase, proveedor Hostinger y salud Telegram. Estas limitaciones no se interpretan como fallas.

## Prueba productiva congelada

> Construí un inventario del stack técnico observable de Company OS. Identificá el principal riesgo confirmado y el principal gap de cobertura. Proponé un próximo paso para cada uno. No ejecutes cambios, no reveles secretos y no modifiques infraestructura.

Debe completar `QUEUED → ANALYZING → AWAITING_REVIEW|COMPLETED`, materializar snapshot/activos/dependencias/health/cobertura/riesgos, crear sólo misiones `PLANNED`, persistir consumo/heartbeat/eventos y deduplicar Telegram.

## Rollback

1. Deshabilitar `company-os-agent-schedule.timer`.
2. Revertir el commit/PR en Vercel y restaurar el worker desde la imagen/copia anterior.
3. Ejecutar, sólo en ventana controlada, el bloque de rollback documentado al final de `20260816175940_systems_manager_ai_v1.sql`.
4. Verificar que los casos existentes del Gerente General conserven `general-manager-ai-v3` y que Company OS V3 siga procesando.

Los datos técnicos son append-only; antes de eliminar tablas, exportarlos o conservarlos según la política operativa.
