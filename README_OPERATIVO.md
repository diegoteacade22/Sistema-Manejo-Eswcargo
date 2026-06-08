# ESWCARGO Core - Vercel package

Paquete limpio de despliegue para ESWCARGO Core.

Runtime actual: Vercel.

URL productiva: `https://webapp-weld-psi.vercel.app`

Proyecto Vercel: `diegos-projects-3b5a60e6/webapp`

Deploy validado: `dpl_BeADzKhzH3RTW9rXxP5QUbHsF675`

## Estructura

El proyecto Vercel existente usa `rootDirectory: webapp`, por eso esta carpeta conserva la app dentro de `webapp/`.

## Validaciones

- Build productivo Vercel: OK.
- `/api/health`: 200.
- `/login`: 200.
- `/clients`: 200.
- `/orders`: 200.
- `/shipments`: 200.
- `/products`: 200.
- `/suppliers`: 200.
- `/purchases`: redirige a `/login` sin error cuando no hay sesion.
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

