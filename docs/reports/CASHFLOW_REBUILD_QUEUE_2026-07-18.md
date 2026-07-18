# Resultado de reconstruccion Cash Flow

Fecha: 2026-07-18. Fuente consultada en solo lectura: `CASH FLOW 2026`.
No se modifico ninguna planilla.

## Reconstruccion completada

- 11 cuentas fuente, 1.112 filas raw.
- 731 actualizaciones, 98 altas y 13 bajas de filas raw que no existen en la
  fuente vigente.
- Las 1.112 filas coinciden exactamente por referencia, fecha, tipo, importe y
  descripcion; los 11 saldos finales cierran contra Cash Flow.
- Los 10 ajustes globales se recalcularon como el negativo de los movimientos
  operativos conservados. No son una diferencia sin explicar.
- Octavio Molina `#273` queda sin ajuste global y con saldo fuente USD 280.
- Marcos Roku `#162` queda sin pagos ni cargos documentales duplicados.

## Cola pendiente con evidencia externa

No se modifica automaticamente ninguna cuenta sin fuente financiera vigente:

- 30 cuentas con solo baseline historico.
- 19 cuentas con baseline mezclado con movimientos posteriores.
- 3 cuentas operativas sin hoja Cash Flow asociada.
- Diferencias de proveedores `INV-5725` (FREEZIA) y `0163445-IN`
  (PLANET CELLULAR).

La evidencia debe registrarse desde `Mantenimiento > Evidencia de cuentas` o
revisarse en las planillas de origen; este sistema no escribe Google Sheets.
