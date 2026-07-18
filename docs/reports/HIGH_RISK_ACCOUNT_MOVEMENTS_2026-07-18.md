# Movimientos de cuenta que requieren comprobante - 2026-07-18

Revisión en modo solo lectura de producción, `CASH FLOW 2026`,
`VENTAS - COMPRAS 2025-2026` y Drive. No se modificaron Google Sheets,
transacciones ni saldos.

## Resultado de la auditoría actual

- Cuentas revisadas: 68.
- Duplicados exactos de cargos/pagos: 0.
- Cargos de pedido asignados al cliente incorrecto: 0.
- Las 11 cuentas vinculadas a Cash Flow mantienen su saldo final coincidente
  con la fuente.
- La búsqueda en Drive no encontró comprobante que resuelva los movimientos
  siguientes.

## Movimientos sin evidencia suficiente

| Cliente | Movimiento | Fecha | Importe | Motivo | Estado |
| --- | ---: | --- | ---: | --- | --- |
| Marcos Roku `#162` | `1173202` | 2026-07-09 | Pago USD 14.700 | Coincide por cliente, fecha, importe y referencia con `1173203`; las descripciones son distintas. | Conservar ambos hasta contar con recibo de caja/banco. |
| Marcos Roku `#162` | `1173203` | 2026-07-09 | Pago USD 14.700 | Creado 40 segundos después de `1173202`; no existe fila equivalente en Cash Flow. | Conservar ambos hasta contar con recibo de caja/banco. |
| Franco Pepe `#84` | `417888` | 2026-04-19 | Pago USD -21.001,80 | El tipo `PAGO` tiene signo negativo, sin referencia ni recibo. | No invertir ni eliminar sin comprobante. |
| Claudio Molina x IG `#261` | `454256` | 2026-05-06 | Pago USD -76.000 | El tipo `PAGO` tiene signo negativo, sin referencia ni recibo. | No invertir ni eliminar sin comprobante. |

Los cuatro movimientos no tienen `PaymentReceipt`, `AccountEvidence` ni clave
de pago histórico vinculada en producción. Cash Flow no contiene a Franco ni a
Claudio como cuentas reconciliables para esos movimientos, y tampoco contiene
un pago de Marcos que permita elegir entre los dos registros.

## Acción requerida para cerrarlos

1. Cargar en Mantenimiento > Evidencia de cuentas el recibo, comprobante
   bancario o confirmación comercial para el movimiento exacto.
2. Reejecutar `audit:ledgers` y `audit:ledger-duplicates`.
3. Sólo entonces aplicar una corrección puntual y reversible en producción.
