# ChatGPT → DiegoServer worker

Objetivo: permitir que ChatGPT cree una tarea controlada en GitHub y que DiegoServer la ejecute localmente con Codex, sin requerir Terminal en el uso diario.

## Flujo

1. ChatGPT crea un issue en `diegoteacade22/Sistema-Manejo-Eswcargo` con label `diegoserver-task`.
2. El worker de DiegoServer consulta la cola cada 60 s.
3. Para cada issue nuevo crea una branch aislada desde `origin/main`.
4. Codex ejecuta la misión dentro de ese repositorio, lee los contratos existentes y corre tests.
5. Si termina correctamente, el worker hace push y abre PR contra `main`.
6. El resultado/PR se comenta en el issue. El merge queda separado del worker.

## Seguridad v1

- Repo permitido fijo: `diegoteacade22/Sistema-Manejo-Eswcargo`.
- No acepta shell arbitrario desde ChatGPT; recibe una misión textual y Codex decide cambios dentro del repo.
- Cada tarea corre en branch independiente.
- No hace merge automático.
- No imprime ni transporta credenciales.
- Usa la autenticación local ya existente de `gh` y `codex`.
- `launchd` mantiene el worker activo aunque la MacBook esté cerrada.

## Instalación única en DiegoServer

Una vez que este cambio esté en `main`, ejecutar en DiegoServer:

```sh
cd ~/02_DESARROLLO/Sistema-Manejo-Eswcargo && git pull --ff-only origin main && zsh company-os/diegoserver-worker/install.sh
```

Después de esa activación inicial, el flujo diario se opera desde ChatGPT/GitHub y no requiere Terminal.
