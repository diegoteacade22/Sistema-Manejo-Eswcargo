# Codex Task Collector y reanudador seguro

Proyecta cada cinco minutos el inventario raíz de Codex al tablero humano de Company OS.

- Lee `session_index.jsonl` y rollouts en modo sólo lectura.
- Excluye subagentes y no copia prompts ni conversaciones.
- Usa el registro canónico de proyectos para mostrar nombres humanos, nunca paths locales.
- `task_complete` sólo puede producir `READY_REVIEW`; nunca marca una tarea como realizada.
- Separa las tareas antiguas `UNREVIEWED` de las que Diego movió explícitamente a `PENDING` (`Para el agente`).
- Firma cada lote con HMAC v2, nonce y timestamp.
- Usa una credencial dedicada `com.esw.company-os-codex-intake.hmac`; no comparte la autoridad del worker.
- Conserva todo estado en `~/.company-os-codex-collector` y se puede desinstalar sin borrar evidencia.
- Limita el endpoint a la URL HTTPS productiva y sólo ejecuta hilos cuya proyección y carpeta coincidan con un proyecto local canónico.
- Cuando la reanudación está habilitada, reclama como máximo una tarea autorizada por vez y la continúa con `codex exec resume` bajo sandbox `workspace-write`, revisión automática de permisos y sin cargar plugins/MCP del perfil interactivo.
- El secreto HMAC se elimina del entorno antes de iniciar Codex y stdout del hilo no se copia. Ante fallo, sólo conserva hasta 64 KiB de stderr saneado en un archivo local `0600` para diagnóstico.
- Un journal atómico distingue `CLAIMING`, `RUNNING` y `EXECUTED`: tras un reinicio reenvía el reporte o detiene la ejecución anterior, pero nunca vuelve a lanzar el mismo claim.
- Un proceso sin cambio verificable, fallido o vencido queda `BLOCKED`; no se reintenta hasta una nueva acción humana.

La clasificación y el inventario son A0. La ejecución sólo nace de una transición humana durable a `PENDING`, queda serializada por host y se detiene ante decisiones, credenciales o efectos externos no autorizados.
