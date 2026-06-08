# ESWCARGO Core - Vercel package

Paquete limpio de despliegue para ESWCARGO Core.

Runtime actual: Vercel.

URL productiva: `https://webapp-weld-psi.vercel.app`

Proyecto Vercel: `diegos-projects-3b5a60e6/webapp`

Deploy validado: `dpl_8ojsMJhanmmL7TcPi3BKQNgDeABn`

## Estructura

El proyecto Vercel existente usa `rootDirectory: webapp`, por eso esta carpeta conserva la app dentro de `webapp/`.

## Validaciones

- Build productivo Vercel: OK.
- `/api/health`: 200.
- `/login`: 200.
- `/setup-account`: 200.
- Modulos internos sin sesion: redirigen a `/login`.
- Logs Vercel recientes: sin errores.

## Excluido

- Railway.
- `.env*`.
- Credenciales.
- DBs locales.
- CSV/XLS/XLSX.
- `node_modules`.
- `.next`.
- `.vercel`.
- Seeds JSON con datos.
