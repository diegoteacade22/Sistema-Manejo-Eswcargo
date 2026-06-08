# ESWCARGO Core - copia limpia candidata

Esta carpeta es una copia candidata para unificar ESWCARGO sin Railway y sin depender de localhost.

Origen: `/Users/diegohrodriguez/02_DESARROLLO/02_Activos_Deploy/Sistema-Manejo-Eswcargo/webapp`

Fork de referencia: `/Users/diegohrodriguez/02_DESARROLLO/02_Activos_Deploy/erp-importaciones-esw/webapp`

## Estado

| Item | Estado |
|---|---|
| Codigo fuente | Copiado |
| `node_modules` | Excluido |
| `.next` | Excluido |
| `.vercel` | Excluido |
| `.env*` | Excluido |
| DBs locales | Excluidas |
| CSV/XLS/XLSX | Excluidos |
| Seed JSON con datos | Excluidos |
| `railway.json` | Excluido |
| Runtime final | Pendiente entre Vercel y VPS |

## Comandos de desarrollo

Localhost queda solo para desarrollo temporal:

```bash
npm install
npm run build
npm run dev
```

## Runtime objetivo

| Runtime | Estado |
|---|---|
| VPS | Recomendado si quedan syncs, jobs, archivos persistentes o Puppeteer robusto |
| Vercel | Posible si se separan jobs/syncs y queda UI/API stateless con DB remota |
| Railway | Fuera del plan |

## Pendiente antes de GitHub/deploy

1. Confirmar DB real y migraciones Prisma.
2. Validar login, roles y permisos.
3. Decidir si se migran cambios del fork para Puppeteer serverless.
4. Decidir si pagos a proveedores del fork coinciden con la DB real.
5. Cargar secretos solo en Vercel o VPS, nunca en Git.
6. Ejecutar build y smoke test.

