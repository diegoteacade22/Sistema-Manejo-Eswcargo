# Auditoria de duplicados de cuenta corriente - 2026-07-18

## Alcance

- Produccion ESWCARGO: 1.122 movimientos operativos analizados en todo el
  historial disponible.
- Se excluyeron ajustes, baselines e importaciones legacy en cuarentena.
- Se contrastaron las alertas de Invoice con `VENTAS - COMPRAS 2025-2026`, sin
  modificar Google Sheets.

## Resultado

- No hay pagos ni cargos duplicados con la misma identidad exacta.
- No hay cargos con igual cliente, documento y monto repetidos.
- `INV #2287`, Luca Sta Fe Nahuel: no es un duplicado. Cash Flow registra una
  devolución y su retorno compensatorio; se clasifica como reversión histórica.

## Inconsistencia que requiere respaldo

- Luca Sta Fe Nahuel (#214), `INV #2352`:
  - Venta operativa: USD 1.265 (fila 213 de `CABE_VENTAS`).
  - Cuenta Cash Flow: cargo USD 9.000 el 2026-02-12 y cargo USD 1.265 el
    2026-02-25, ambos rotulados `INV #2352`.
  - Sistema: `tx 1088025` (USD -9.000) y `tx 1088031` (USD -1.265).

El cargo de USD 9.000 no puede corresponder al Invoice #2352. No se borra ni
se reasigna automáticamente: falta el documento que identifique a qué venta o
concepto corresponde.
