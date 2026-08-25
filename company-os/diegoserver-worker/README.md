# ChatGPT → DiegoServer worker

Objetivo: permitir que ChatGPT cree una tarea controlada en GitHub y que DiegoServer la ejecute localmente con Codex, sin requerir Terminal en el uso diario.

## Flujo

1. ChatGPT crea un issue en `diegoteacade22/Sistema-Manejo-Eswcargo` con label `diegoserver-task`.
2. El worker de DiegoServer consulta la cola cada 60 s.
3. Trabaja exclusivamente en el clon aislado `~/.diegoserver-worker/repo`.
4. Para cada issue crea una branch desde `origin/main` dentro de ese clon.
5. Codex ejecuta la misión, lee los contratos existentes y corre tests.
6. Si termina correctamente, el worker hace push y abre PR contra `main`.
7. El resultado/PR se comenta en el issue. El merge queda separado del worker.

## Seguridad v1

- Repo permitido fijo: `diegoteacade22/Sistema-Manejo-Eswcargo`.
- El checkout operativo visible en Codex y cualquier cambio local del usuario quedan fuera del alcance del worker.
- El worker rechaza `DIEGOSERVER_REPO` si no está dentro de `~/.diegoserver-worker`.
- `reset --hard` y `clean -fd` sólo pueden ejecutarse en el clon aislado.
- No acepta shell arbitrario desde ChatGPT; recibe una misión textual y Codex decide cambios dentro del repo.
- Cada tarea corre en branch independiente.
- No hace merge automático.
- No imprime ni transporta credenciales.
- Usa la autenticación local ya existente de `gh` y `codex`.
- `launchd` mantiene el worker activo aunque la MacBook esté cerrada.

## Instalación o actualización en DiegoServer

```sh
cd ~/02_DESARROLLO/02_Activos_Deploy/Sistema-Manejo-Eswcargo && git pull --ff-only origin main && zsh company-os/diegoserver-worker/install.sh
```

El instalador copia el runtime a `~/.diegoserver-worker/worker.mjs`, crea o reutiliza el clon aislado y reinicia únicamente `com.esw.diegoserver-worker`.

Después de esta activación, el flujo diario se opera desde ChatGPT/GitHub y no requiere Terminal.
