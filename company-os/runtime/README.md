# Runtime Company OS 24/7 en DiegoServer

Runtime genérico advisory-only para la Mac mini. Consume exclusivamente el
inbox durable de Company OS mediante `/api/company-os/runtime/v1/*`; no usa
GitHub Issues, no consulta Supabase directamente y no mantiene un modelo activo
cuando la cola está vacía.

## Contrato operativo

- polling de claims: 15 segundos;
- heartbeat del worker aun ocioso: 60 segundos;
- reconciliación de leases y scheduler: 60 segundos;
- heartbeat del lease activo: 30 segundos;
- concurrencia global: 2; concurrencia por agente: 1;
- health local: `http://127.0.0.1:8794/health`;
- fallback local: Ollama sólo en loopback y modelo exacto `qwen3:14b-q4_K_M`;
- apagado: `DRAINING`, espera máxima 30 segundos y `STOPPED`;
- lock local: `~/.company-os-runtime/runtime.lock`;
- logs JSONL saneados y rotados en `~/.company-os-runtime/logs/`;
- notificaciones externas: deshabilitadas en la instalación Mac genérica.

El allowlist predeterminado incluye `general-manager-ai-v3`,
`systems-manager-ai-v1` y `data-manager-ai-v1`. Data Manager se enruta sólo al
modelo Ollama local; el cliente OpenAI rechaza ese claim antes de efectuar
egress.

El servidor conserva la autoridad sobre claims, slots, leases, reintentos,
presupuestos y transiciones. Obtener `204` en `claim` no llama OpenAI.
Cada claim debe traer el contrato instalado completo y
`contract.outputSchema`; el worker usa ese schema firmado en Responses API y
falla cerrado, sin llamar al modelo, si falta o no es estricto. `fail` persiste
`errorCode`, detalle saneado, condición de reintento y usage disponible.

El heartbeat reporta las dependencias core con estados `HEALTHY`, `DEGRADED`,
`UNAVAILABLE` o `UNOBSERVED`. La falta de una sonda directa —por ejemplo a
Supabase— se declara `UNOBSERVED`, nunca se infiere como caída.

## HMAC runtime v2

Cada POST incluye:

- `x-company-os-signature-version: v2`;
- `x-company-os-worker-id`;
- `x-company-os-nonce`, aleatorio por request;
- `x-company-os-timestamp`, Unix en segundos;
- `x-company-os-signature: sha256=<hex>`.

El mensaje firmado exacto es
`${workerId}.${nonce}.${timestamp}.${rawBody}`. El servidor debe persistir el
nonce de manera temporal y rechazar replays.

## Credenciales en macOS Keychain

El instalador nunca copia, imprime ni guarda secretos en el plist. Lee al
arrancar dos generic passwords del Keychain, para la cuenta del usuario:

- `com.esw.company-os-runtime.hmac` → `COMPANY_OS_RUNTIME_HMAC_SECRET`;
- `OPENAI_API_KEY` → credencial OpenAI existente, reutilizada por referencia sin copiarla.

Los nombres se cambian mediante
`COMPANY_OS_RUNTIME_HMAC_KEYCHAIN_SERVICE`,
`COMPANY_OS_RUNTIME_OPENAI_KEYCHAIN_SERVICE` y
`COMPANY_OS_RUNTIME_KEYCHAIN_ACCOUNT`. Crear o seleccionar esas entradas desde
Keychain Access; `doctor` informa el nombre exacto ausente, nunca el valor.

## Gestión única

Desde cualquier checkout real que contenga este archivo:

```sh
zsh company-os/runtime/manage.sh doctor
zsh company-os/runtime/manage.sh install
zsh company-os/runtime/manage.sh status
zsh company-os/runtime/manage.sh restart
zsh company-os/runtime/manage.sh rollback
zsh company-os/runtime/manage.sh uninstall
```

`install` autodetecta el repositorio, ejecuta los tests, crea un snapshot previo,
instala una copia aislada en `~/.company-os-runtime/current` y recién entonces
recarga `com.esw.company-os-runtime`. `uninstall` mueve lo instalado a un backup;
no borra logs ni evidencia. `rollback` restaura el último snapshot y deja otro
snapshot de seguridad. Los snapshots tienen nombres únicos y `last-backup` se
actualiza por reemplazo atómico. `install` y `restart` sólo terminan bien cuando
la versión objetivo 1.1 confirma heartbeat, estado operativo y que el PID del
listener pertenece al LaunchAgent. Un rollback acepta una versión propia previa,
pero exige el mismo readback operativo; si un cutover falla, la restauración se
verifica antes de informar que el estado anterior fue recuperado.

Con el fallback habilitado (valor por defecto), `doctor` exige un origen Ollama
HTTP loopback puro y verifica mediante `/api/tags` que exista exactamente
`qwen3:14b-q4_K_M`. No imprime la respuesta ni datos de credenciales. Un runtime
propio de versión previa puede ocupar el puerto durante un cutover; cualquier
listener cuyo PID no coincida con `com.esw.company-os-runtime` se rechaza.

El origen API por defecto es `https://webapp-weld-psi.vercel.app`. Para otro
origen HTTPS debe configurarse también su hostname en
`COMPANY_OS_RUNTIME_ALLOWED_HOSTS`. El puerto se cambia con
`COMPANY_OS_RUNTIME_HEALTH_PORT`.

## Verificación sin instalar

```sh
cd webapp/company-os-worker
npm test
node --check src/server.mjs
zsh -n ../../company-os/runtime/manage.sh
```

Estas pruebas son locales y simuladas. No prueban launchd, heartbeat productivo,
claims reales, recuperación tras crash ni ausencia de DML empresarial; esas
evidencias requieren instalación y prueba productiva controlada posteriores.
