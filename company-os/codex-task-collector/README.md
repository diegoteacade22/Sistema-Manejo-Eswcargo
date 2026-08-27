# Codex Task Collector

Proyecta cada cinco minutos el inventario raíz de Codex al tablero humano de Company OS.

- Lee `session_index.jsonl` y rollouts en modo sólo lectura.
- Excluye subagentes y no copia prompts ni conversaciones.
- Usa el registro canónico de proyectos para mostrar nombres humanos, nunca paths locales.
- `task_complete` sólo puede producir `READY_REVIEW`; nunca marca una tarea como realizada.
- Firma cada lote con HMAC v2, nonce y timestamp.
- Usa una credencial dedicada `com.esw.company-os-codex-intake.hmac`; no comparte la autoridad del worker.
- Conserva todo estado en `~/.company-os-codex-collector` y se puede desinstalar sin borrar evidencia.

La clasificación y el inventario son A0. La ejecución queda separada y fail-closed.
