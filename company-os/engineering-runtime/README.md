# Company OS Engineering V2 — runner temporal

Runner `launchd` separado para misiones A1/A2. Es un consumidor reemplazable:
PostgreSQL/API Company OS conserva misiones, capabilities, fencing, estados,
efectos e idempotencia. El runner nunca es fuente de verdad.

## Límites

- Un repositorio fijo por instalación, identificado por path local y slug.
- A1: clon descartable, Codex `workspace-write` dentro de Docker y cero efectos.
- A2: sólo branch `codex/engineering-v2-*`, push y Draft PR tras reserva durable.
- No hay código para merge, deploy, datos productivos, secrets o mensajes.
- `.github`, migraciones, env/secrets, symlinks, submodules y paths fuera de la
  capability fallan cerrado.
- Codex sólo ve `/workspace` RW y un auth dir dedicado RO; no ve HOME, Keychain,
  token GitHub ni la configuración `gh` del host. El contenedor es read-only,
  sin capabilities, y el sandbox interno bloquea la red de sus herramientas.
- Un timeout termina el grupo de procesos completo.
- El endpoint local `127.0.0.1:8795/health` no otorga autoridad.

## Protocolo esperado

Todos los POST usan HMAC v2 con worker, nonce, timestamp y body exacto:

```text
/api/company-os/engineering/v2/claim
/api/company-os/engineering/v2/heartbeat
/api/company-os/engineering/v2/transition
/api/company-os/engineering/v2/complete
/api/company-os/engineering/v2/fail
/api/company-os/engineering/v2/effect/{reserve,dispatching,confirm,unknown,reconcile}
```

`claim` debe devolver `{ mode: EXECUTE|RECONCILE, mission, lease, effects }` conforme a
`AUTONOMOUS_ENGINEERING_V2.md`; el hash de misión cubre sus campos inmutables y
excluye `expectedStateVersion`. Un `204` mantiene el runner `IDLE` y no invoca
Codex. Heartbeat confirma `renewed`; transiciones y terminales devuelven su
`status`; reserve devuelve `{ reused, dispatch, effectId, status }`. Los
endpoints ausentes, una lease vencida o una reserva no confirmada impiden toda
ejecución/efecto. Un replay de effect sólo reconcilia por marker: nunca vuelve a
despachar.

## Instalación

Las credenciales no se copian al plist. HMAC se resuelve desde Keychain service
`com.esw.company-os-runtime.hmac`. A2 resuelve un token GitHub separado desde
`com.esw.company-os-engineering-v2.github-token`; sólo se entrega a los adapters
Git/`gh`. Codex usa un auth dir dedicado RO.

```sh
export COMPANY_OS_ENGINEERING_REPOSITORY_PATH=/ruta/al/repo-fijo
export COMPANY_OS_ENGINEERING_REPOSITORY_SLUG=owner/repository
export COMPANY_OS_ENGINEERING_MAX_AUTONOMY=A1
export COMPANY_OS_ENGINEERING_CODEX_AUTH_DIR="$HOME/.company-os-engineering-v2/codex-auth"
install -d -m 700 "$COMPANY_OS_ENGINEERING_CODEX_AUTH_DIR"
CODEX_HOME="$COMPANY_OS_ENGINEERING_CODEX_AUTH_DIR" codex login
docker build -f webapp/company-os-engineering-worker/Dockerfile.codex \
  -t company-os-codex:0.150.1 webapp/company-os-engineering-worker
zsh company-os/engineering-runtime/manage.sh doctor
zsh company-os/engineering-runtime/manage.sh install
zsh company-os/engineering-runtime/manage.sh status
```

Cambiar a A2 requiere endpoints productivos, reserva/reconcile live y una
instalación explícita con `COMPANY_OS_ENGINEERING_MAX_AUTONOMY=A2`.

Rollback y desinstalación son recuperables:

```sh
zsh company-os/engineering-runtime/manage.sh rollback
zsh company-os/engineering-runtime/manage.sh uninstall
```
