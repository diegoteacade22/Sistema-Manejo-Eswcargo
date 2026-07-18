# Revisión de posible pago duplicado de cliente

## Alcance

Auditoría de los 1.225 movimientos de cuenta corriente disponibles en
producción, desde 2025-02-01 hasta 2026-07-18. La consulta agrupa pagos por
cliente, fecha, importe y referencia, sin permitir que una diferencia de método
de pago o descripción oculte una posible repetición.

## Hallazgo

Un único grupo requiere comprobante antes de cualquier cambio:

| Cliente | Fecha | Importe | Referencia | Movimientos |
| --- | --- | ---: | --- | --- |
| Marcos Roku `#162` | 2026-07-09 | USD 14.700 | `Manual` | `1173202`, `1173203` |

- `1173202`: 15:31:58, descripción `CAja 15k - 300`, método vacío.
- `1173203`: 15:32:39, descripción `Caja Transporte 15 - 300 comi`, método
  `EFECTIVO`.
- La diferencia de creación es de 40 segundos.
- La lectura actual de `MARCOS CC` en `CASH FLOW 2026` no contiene una fila de
  USD 14.700 de esa fecha. Por ello la fuente no prueba si existió un pago o
  dos pagos independientes.

## Decisión aplicada

No se eliminó ningún movimiento ni se modificó `CASH FLOW 2026`.

El alta de pagos ahora bloquea una nueva repetición con el mismo cliente,
fecha, importe y referencia aunque cambie u omita el método de pago. La
auditoría se ejecuta antes y después de cada sincronización y Mantenimiento
mantiene visible el caso hasta que se aporte un comprobante.
