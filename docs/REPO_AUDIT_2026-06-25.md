# Auditoria de orden del repo - 2026-06-25

## Cambios seguros aplicados

- Se removieron logs generados del control de versiones:
  - `logs/sync/auto_sync.log`
  - `logs/sync/cron.log`
  - `logs/sync/extract_summary_history.jsonl`
  - `logs/sync/extract_summary_latest.json`
  - `webapp/logs/marcos_cc_fix_result.json`
- Se agregaron reglas a `.gitignore` para que no vuelvan a entrar logs ni salidas runtime.
- Se corrigio `webapp/prisma/migrations/migration_lock.toml` de `sqlite` a `postgresql`, alineado con `schema.prisma`.

## Riesgos detectados

- Hay muchos scripts sueltos de diagnostico en raiz y `webapp/` (`debug_*`, `check_*`, `analyze_*`, `inspect_*`). No se borraron porque algunos pueden servir para reconstruir conciliaciones.
- `npm run lint` no esta usable como control de calidad: hoy reporta cientos de errores historicos, principalmente `any`, efectos React y scripts auxiliares.
- La sincronizacion aun depende de Python local en varios scripts. En Vercel conviene mantener el flujo por hook/API o mover extraccion a Node para evitar `python3: command not found`.
- La auditoria de CC detecto datos reales pendientes:
  - `Franco Pepe #84`: tx `417888`, tipo `PAGO` con monto negativo, descripcion `Saldada`.
  - `Claudio Molina x IG #261`: tx `454256`, tipo `PAGO` con monto negativo, descripcion `Pago a cuenta`.
  - Cliente sin nombre `old_id #288`, id interno `454`, saldo `-$6,125`.
  - Duplicado de nombre con saldo en `Federico Esquivel - Canning`: ids internos `500` y `501`.

## Proxima limpieza recomendada

1. Crear carpeta `webapp/scripts/manual-audits/` y mover ahi scripts puntuales de `check_*`, `debug_*`, `analyze_*`.
2. Convertir los scripts utiles en comandos npm con nombre claro.
3. Borrar scripts que solo imprimen informacion ya cubierta por `scripts/audit-ledgers.mjs`.
4. Separar `lint` de app productiva y scripts legacy para que vuelva a servir como bloqueo real.
