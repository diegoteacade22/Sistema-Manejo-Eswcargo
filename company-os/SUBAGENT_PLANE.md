# Plano mínimo de subagentes

## Decisión

El worker mantiene la ejecución existente y usa `webapp/lib/company-os/specialist-routing.ts` como adaptador de routing y guardrails. No se incorpora `@openai/agents` en esta etapa.

La razón es operativa: la cola durable, los leases, el límite de concurrencia, el heartbeat, los attempts, los eventos y el proveedor de inferencia ya viven en el worker actual. Agregar Agents SDK allí duplicaría el loop de ejecución y no aportaría una persistencia durable equivalente. El SDK queda como opción futura si se necesita su tracing o handoff dentro del mismo handler y se puede probar la integración sin crear otra cola.

## Contrato cerrado

- `SYSTEMS_OBSERVABILITY` enruta a `systems-manager-ai-v1`.
- `DATA_QUALITY_FRESHNESS` enruta a `data-manager-ai-v1`.
- Ambos reportan a `general-manager-ai-v3`.
- La profundidad máxima es `1`; el retorno al general se crea como otro `CompanyOsWorkItem` en la misma cola.
- Las herramientas declaradas son `READ_ONLY_DETERMINISTIC`; no hay efectos externos por defecto.
- `NEEDS_USER` y `BLOCKED_EXTERNAL` se rechazan con error explícito antes de aceptar la delegación.

La respuesta estructurada continúa validándose contra el contrato cerrado y las referencias de evidencia materializadas. El store conserva la trazabilidad de work item, causal message, lease, execution attempt, usage, resultado, error y eventos append-only.

## Límites

La cola existente conserva un especialista por turno, concurrencia por agente igual a uno, profundidad uno, `maxTurns`, timeout, attempts y presupuesto de tokens. Una respuesta de especialista genera como máximo un retorno al general. No se agregan scheduler, worker, tabla ni control plane paralelos.
