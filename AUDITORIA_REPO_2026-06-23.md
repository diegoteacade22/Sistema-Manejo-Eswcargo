# Auditoria repo ESWCARGO - 2026-06-23

## Estado verificado

- Branch de trabajo: `codex/repo-cleanup-audit`.
- Build probado varias veces con `npm run build` dentro de `webapp`: OK.
- Deploy productivo actual corregido manualmente en Vercel con variables restauradas: `webapp-weld-psi.vercel.app`.

## Commits realizados en esta rama

1. `915aa84` - Ordenar tracking y configuracion de deploy.
2. `f2b11db` - Estabilizar movimientos de cuenta corriente.
3. `92e4f49` - Agregar endpoint de salud.
4. `f8e36c1` - Depurar scripts prisma obsoletos.

## Riesgos detectados

- Vercel `webapp` tenia `Root Directory` remoto en `.`. Se agrego `vercel.json` para que el build automatico ejecute desde `webapp`, pero conviene corregir tambien el setting en Vercel a `webapp`.
- Las variables sensibles de Vercel aparecieron vacias en runtime y se restauraron manualmente. Revisar `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, `SMTP_PASS`.
- `npm run lint` falla con deuda vieja: 334 errores y 71 warnings, principalmente `any`, hooks con `setState` en efecto, scripts Prisma y componentes legacy.
- `npm audit --omit=dev` reporta 29 vulnerabilidades productivas: 1 low, 23 moderate, 3 high, 2 critical.
- El modulo local de Documentos depende de `ESW_DOCS_EXPORT_DIR`; no debe publicarse sin asegurar esa variable y una estrategia persistente de storage.
- Hay cambios locales de Compras/PDF/Schema que parecen retroceder campos financieros (`due_date`, `paid_amount`, `balance_due`, `PurchasePayment`) y quitar soporte serverless de Chromium. No mezclar sin revision funcional.
- Los JSON seed de productos, pedidos y envios tienen cambios masivos. Deben tratarse como refresh de datos separado, no junto a codigo.

## Limpieza pendiente recomendada

- Mover scripts raiz `debug_*`, `check_*`, `test_*`, `analyze_*`, `inspect_*` a una carpeta `tools/legacy/` o eliminarlos si ya no se usan.
- Excluir `webapp/node_modules` de auditorias locales y comandos `find`.
- Dividir `webapp/prisma/seed_fast.ts` en modulos mas chicos: clientes, productos, envios, pedidos, transacciones.
- Tipar gradualmente `app/page.tsx`, `analytics-actions.ts`, `app/actions.ts` y `seed_fast.ts`.
- Revisar dependencia `puppeteer`/PDF antes de cambiar Chromium serverless.
- Definir storage persistente para comprobantes y documentos antes de habilitar uploads en Vercel.
