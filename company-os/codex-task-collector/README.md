# Codex Task Collector y reanudador seguro

Proyecta cada cinco minutos el inventario raíz de Codex al tablero humano de Company OS.

- Lee `session_index.jsonl` y rollouts en modo sólo lectura.
- Excluye subagentes y no copia prompts ni conversaciones. Para tareas que esperan a Diego conserva por separado el motivo del bloqueo y la única autorización o decisión requerida. Si detecta secretos o datos personales/comerciales, descarta el fragmento sensible y pide sólo confirmar la autorización o el paso seguro, sin copiar credenciales ni códigos.
- Usa el registro canónico de proyectos para mostrar nombres humanos, nunca paths locales.
- Una tarea interrumpida en las últimas 72 horas entra automáticamente a `PENDING`; las antiguas siguen en `UNREVIEWED` para evitar reactivar todo el historial.
- El reanudador exige un resultado estructurado. `AUTONOMY_RESULT: COMPLETED`, un nuevo `task_complete`, cambio de fingerprint y readback posterior prueban la entrega de un resultado (`deliveryVerified`); el objetivo fuente queda en `READY_REVIEW` hasta su validación específica o cierre humano. El marcador del modelo por sí solo no autoriza `DONE` ni `verifiedCompletion=true`. Una continuación verificada conserva su autorización durable y vuelve a ser elegible en el siguiente ciclo; una respuesta humana ya consumida se marca entregada una sola vez.
- Firma cada lote con HMAC v2, nonce y timestamp.
- La instalación sólo se confirma tras observar un inventario fresco y una respuesta válida del polling de despacho firmado.
- Un lock de kernel de macOS impide dos ejecuciones simultáneas; instalación y desinstalación usan además un lock de control separado.
- La instalación deja un journal durable antes de detener el servicio: una interrupción restaura la versión previa al reintentar, y el rollback también exige readback operativo.
- La desinstalación usa su propio journal, se niega ante un despacho sin reconciliar y conserva el estado para recuperarlo sin duplicar trabajo.
- Un start-gate impide que el collector escanee o reclame tareas antes de publicar su identidad en el lock compatible con la versión anterior.
- Un collector legacy huérfano bloquea instalación y desinstalación hasta desaparecer; nunca se interpreta como un lock obsoleto.
- Usa una credencial dedicada `com.esw.company-os-codex-intake.hmac`; no comparte la autoridad del worker.
- Conserva todo estado en `~/.company-os-codex-collector` y se puede desinstalar sin borrar evidencia.
- Limita el endpoint a la URL HTTPS productiva y sólo ejecuta hilos cuya proyección y carpeta coincidan con un proyecto local canónico.
- Cuando la reanudación está habilitada, reclama como máximo una tarea autorizada por vez y la continúa con `codex exec resume` bajo sandbox `workspace-write`, revisión automática de permisos y sin cargar plugins/MCP del perfil interactivo.
- Una respuesta escrita en el tablero crea una revisión inmutable y una única entrega confirmada. El claim verifica tarea, fingerprint y hash antes de incorporarla al hilo; modificarla antes del claim reemplaza la entrega pendiente sin borrar el historial.
- La ficha cierra todo el circuito sin obligar a volver a Codex: muestra resumen, motivo, autorización requerida, respuesta editable, `respuesta guardada`, `en cola`, `Codex trabajando` y el resultado humano verificado. Guardar nunca se presenta como tarea resuelta.
- El agente emite `BLOCKER_REASON`, `DIEGO_DECISION` y `DASHBOARD_RESULT`; el collector proyecta sólo esas síntesis saneadas y el tablero conserva el enlace a Codex únicamente como historial técnico opcional.
- El secreto HMAC se elimina del entorno antes de iniciar Codex y no copia stdout ni stderr del hilo. Ante fallo, conserva sólo exit code, señal, cantidad de bytes y hash de stderr en un archivo local `0600`.
- Un journal atómico distingue `CLAIMING`, `RUNNING` y `EXECUTED`: tras un reinicio reenvía el reporte o detiene la ejecución anterior, pero nunca vuelve a lanzar el mismo claim.
- Un fallo de proceso se reintenta hasta completar tres intentos seguros. Recién entonces queda `BLOCKED`; credenciales, OTP, CAPTCHA, decisiones irreversibles y dependencias externas se separan sin improvisar.

La clasificación y el inventario son A0. La ejecución nace de una autorización humana durable, una respuesta explícitamente confirmada o la política versionada para una interrupción reciente A1; queda serializada por host y se detiene ante decisiones, credenciales o efectos externos no autorizados.
