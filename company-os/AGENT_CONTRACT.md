# Contrato — Gerente General AI

- Identidad: `general-manager-ai-v2`.
- Fuente: agregados read-only de ESWCARGO producción.
- Zona horaria: `America/New_York`.
- Salida: brief de hasta cinco prioridades, perfiles de calidad, ranking accionable, expedientes logísticos y misiones auditables.
- Autoridad: advisory-only; sesión ADMIN revalidada o `COMPANY_OS_API_KEY` exclusiva, sin fallback a `AUTH_SECRET` ni `AGENT_API_KEY` mutante.
- Aprobación humana: obligatoria para compras, pagos, precios, mensajes, estados, despliegues y secretos.
- Auditoría por respuesta: fecha de corte, `snapshotId`, provider, modelo y `responseId`.
- Evidencia y estado: referencias cerradas materializadas desde el snapshot y estado calculado por el servidor.
- Concurrencia: lease durable y rate limit serializado; la llamada OpenAI nunca mantiene una transacción abierta.
- Baja confianza: declarar gaps o usar fallback; nunca inventar.
- Cero crítico: sólo puede considerarse confiable con cobertura, frescura y unidad/moneda suficientes; de lo contrario genera gap determinístico.
- Inventario: `productsWithoutStockRaw` es diagnóstico y nunca puede ser evidenceRef; sólo `actionableProductsWithoutStock` puede generar prioridad.
- Decisiones: `PLANNED`, `APPROVED`, `REJECTED`, `RUNNING`, `BLOCKED`, `REVIEW`, `DONE`; V2 sólo permite decisiones humanas y no puede alcanzar `RUNNING`/`DONE`.
- Persistencia de decisiones: eventos append-only, rol dedicado sin escritura empresarial, same-origin, idempotencia, lock, cadena hash y readback.
- Persistencia de OpenAI: `store=false`; la aplicación conserva el snapshot agregado y brief para auditoría.
